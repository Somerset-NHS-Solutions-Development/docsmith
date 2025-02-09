const fp = require("fastify-plugin");
const { JSDOM } = require("jsdom");
const { minify } = require("html-minifier-terser");
const { tidy } = require("htmltidy2");
const { promisify } = require("util");
const { check } = require("language-tags");

const tidyP = promisify(tidy);

/**
 * @author Frazer Smith
 * @description Decorator plugin that adds function that uses HTMLTidy2
 * and HTMLMinifier to parse, tidy, and minify HTML passed.
 * @param {object} server - Fastify instance.
 */
async function plugin(server) {
	/**
	 * @param {string} html - Valid HTML.
	 * @param {object} options - Function config values.
	 * @param {string} [options.language="en"] - Set `lang` and `xml:lang` attributes of `<html>` tag.
	 * @param {boolean=} options.removeAlt - Set `alt` attributes in `<img>` tags to empty string if set to `true`.
	 * Useful for sending to clinical systems where img tags are stripped from received documents
	 * (i.e. TPP's SystmOne), and for screen reader users.
	 * @returns {Promise<string|Error>} Promise of tidied HTML string on resolve, or HTTP Error object on rejection
	 * if `querystring.language` not a valid IANA language tag.
	 */
	async function tidyHtml(html, options = {}) {
		const dom = new JSDOM(html);

		// Set document language if valid IANA language tag and subtag
		const language = options.language || "en";
		if (!check(language)) {
			throw server.httpErrors.badRequest(
				"querystring.language not a valid IANA language tag"
			);
		}
		const innerHtml = dom.window.document.querySelector("html");
		innerHtml.setAttribute("lang", language);
		innerHtml.setAttribute("xml:lang", language);

		/**
		 * When an alt attribute is not present in an <img> tag, screen readers may announce the image's file name instead.
		 * This can be a confusing experience if the file name is not representative of the image's contents.
		 * See https://dequeuniversity.com/rules/axe/4.4/image-alt?application=axeAPI
		 *
		 * As such, alt attributes in <img> tags are set to an empty string rather than removed here
		 */
		if (options.removeAlt === true) {
			dom.window.document.querySelectorAll("img").forEach((element) => {
				element.setAttribute("alt", "");
			});
		}

		const parsedHtml = dom.serialize();

		/**
		 * Refer to https://api.html-tidy.org/tidy/tidylib_api_5.8.0/tidy_quickref.html for tidy options
		 *
		 * The following options have been turned on:
		 * - bare (replace smart quotes and em dashes with ASCII and replace `&nbsp;` with spaces)
		 * - clean (replace legacy HTML tags)
		 * - dropProprietaryAttributes (remove proprietary attributes, such as Microsoft data binding attributes)
		 * - escapeCdata (convert <![CDATA[]]> sections to normal text)
		 */
		const tidiedHtml = await tidyP(parsedHtml, {
			bare: true,
			clean: true,
			dropProprietaryAttributes: true,
			escapeCdata: true,
		});

		// Refer to https://github.com/terser/html-minifier-terser#options-quick-reference for options
		const minifiedHtml = await minify(tidiedHtml, {
			collapseWhitespace: true,
			decodeEntities: true,
			removeComments: true,
			removeEmptyAttributes: true,
			removeRedundantAttributes: true,
			sortAttributes: true,
			sortClassName: true,
		});

		return minifiedHtml;
	}

	server.decorate("tidyHtml", tidyHtml);
}

module.exports = fp(plugin, {
	fastify: "4.x",
	name: "tidy-html",
	dependencies: ["@fastify/sensible"],
});
