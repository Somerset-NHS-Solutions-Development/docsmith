/* eslint-disable security/detect-non-literal-fs-filename */
const fixUtf8 = require("fix-utf8");
const fp = require("fastify-plugin");
const fs = require("fs/promises");
const { glob } = require("glob");
const { JSDOM } = require("jsdom");
const path = require("upath");
const { UnRTF } = require("node-unrtf");
const { randomUUID } = require("crypto");

/**
 * @author Frazer Smith
 * @description Pre-handler plugin that uses UnRTF to convert Buffer containing
 * RTF file in `req.body` to HTML and places RTF file in a temporary directory.
 * `req` object is decorated with `conversionResults` object detailing document
 * location and contents.
 * @param {object} server - Fastify instance.
 * @param {object} options - Plugin config values.
 * @param {string} options.binPath - Path to UnRTF binary.
 * @param {object=} options.rtfToHtmlOptions - Refer to
 * https://github.com/Fdawgs/node-unrtf/blob/main/API.md
 * for options.
 * @param {string} options.tempDir - Directory for temporarily storing
 * files during conversion.
 */
async function plugin(server, options) {
	const directory = path.normalizeTrim(options.tempDir);
	const unrtf = new UnRTF(options.binPath);

	// Create temp directory if missing
	try {
		await fs.mkdir(directory);
	} catch (err) {
		// Ignore "EEXIST: An object by the name pathname already exists" error
		/* istanbul ignore if */
		if (err.code !== "EEXIST") {
			throw err;
		}
	}

	server.addHook("onRequest", async (req) => {
		req.conversionResults = { body: undefined };
	});

	/**
	 * "onSend" hook used instead of "onResponse" ensures
	 * cancelled request temp data is also removed
	 */
	server.addHook("onSend", async (req, _res, payload) => {
		if (req?.conversionResults?.docLocation) {
			// Remove files from temp directory after response sent
			const files = await glob(
				`${path.joinSafe(
					req.conversionResults.docLocation.directory,
					req.conversionResults.docLocation.id
				)}*`
			);

			await Promise.all(files.map((file) => fs.unlink(file)));
		}

		return payload;
	});

	server.addHook("preHandler", async (req, res) => {
		// Define any default settings the plugin should have to get up and running
		const config = {
			rtfToHtmlOptions: {
				noPictures: true,
				outputHtml: true,
			},
			...options,
		};

		// Build temporary file for UnRTF to write to, and following plugins to read from
		const id = `docsmith_rtf-to-html_${randomUUID()}`;
		const tempFile = path.joinSafe(directory, `${id}.rtf`);
		req.conversionResults.docLocation = {
			directory,
			rtf: tempFile,
			id,
		};
		await fs.writeFile(tempFile, req.body);

		try {
			// Add title to document
			const dom = new JSDOM(
				await unrtf.convert(tempFile, config.rtfToHtmlOptions)
			);
			const element = dom.window.document.createElement("title");
			element.innerHTML = id;
			dom.window.document.head.prepend(element);

			/**
			 * UnRTF < v0.20.4 ignores `noPictures` option and
			 * generates img tags whilst placing images in cwd.
			 *
			 * UnRTF generates the image name i.e. `pict001.wmf`, `pict002.wmf` and so on.
			 * This means files can be safely removed from the cwd without running the
			 * risk of removing any important files such as `package.json`, should an image
			 * ever have the same name.
			 */
			const images = dom.window.document.querySelectorAll("img");
			if (images.length > 0) {
				await Promise.all(
					Array.from(images).map((image) => {
						const { src } = image;
						image.remove();
						/**
						 * `rm()` used instead of `unlink()` because concurrent requests may create duplicate files,
						 * which could cause `unlink()` to throw an ENOENT error if the file has already been removed
						 * by another request's call of this hook.
						 */
						return fs.rm(path.joinSafe(process.cwd(), src), {
							force: true,
						});
					})
				);
			}

			/**
			 * `fixUtf8` function replaces most common incorrectly converted
			 * Windows-1252 to UTF-8 results with HTML equivalents.
			 * Refer to https://i18nqa.com/debug/utf8-debug.html for more info
			 */
			req.conversionResults.body = fixUtf8(dom.serialize());
		} catch (err) {
			/**
			 * UnRTF will throw if the .rtf file provided
			 * by client is malformed, thus client error code
			 */
			/* istanbul ignore else: unable to test unknown errors */
			if (/File is not the correct media type/.test(err)) {
				throw server.httpErrors.badRequest();
			} else {
				throw err;
			}
		}

		res.type("text/html");
	});
}

module.exports = fp(plugin, {
	fastify: "4.x",
	name: "rtf-to-html",
	dependencies: ["@fastify/sensible"],
});
