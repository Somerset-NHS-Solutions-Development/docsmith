const { UnsupportedMediaType } = require("http-errors");
const fileType = require("file-type");

// Import plugins
const cors = require("fastify-cors");
const pdfToTxt = require("../../../plugins/pdf-to-txt");

const { pdfToTxtPostSchema } = require("./schema");

/**
 * @author Frazer Smith
 * @description Sets routing options for server.
 * @param {Function} server - Fastify instance.
 * @param {object} options - Object containing route config objects.
 */
async function route(server, options) {
	server.addContentTypeParser(
		"application/pdf",
		{ parseAs: "buffer" },
		async (req, payload) => {
			/**
			 * The Content-Type header can be spoofed so is not trusted implicitly,
			 * this checks for PDF specific magic numbers.
			 */
			const results = await fileType.fromBuffer(payload);
			if (
				results === undefined ||
				results.mime === undefined ||
				results.mime !== "application/pdf"
			) {
				throw UnsupportedMediaType();
			} else {
				return payload;
			}
		}
	);

	// Use CORS: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
	server
		.register(cors, {
			...options.cors,
			methods: ["POST"],
			hideOptionsRoute: true,
		})
		.register(pdfToTxt, options);

	server.route({
		method: "POST",
		url: "/",
		schema: pdfToTxtPostSchema,
		async handler(req, res) {
			let result;
			if (
				req.query.boundingBoxXhtml ||
				req.query.boundingBoxXhtmlLayout ||
				req.query.generateHtmlMetaFile
			) {
				result = await server.tidyHtml(req.pdfToTxtResults.body);
			} else {
				result = req.pdfToTxtResults.body;
			}

			res.send(result);
		},
	});
}

module.exports = route;
