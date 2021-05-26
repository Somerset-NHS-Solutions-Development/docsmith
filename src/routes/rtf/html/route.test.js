const fs = require("fs");
const Fastify = require("fastify");
const isHtml = require("is-html");
const plugin = require(".");
const getConfig = require("../../../config");

const embedHtmlImages = require("../../../plugins/embed-html-images");
const tidyCss = require("../../../plugins/tidy-css");
const tidyHtml = require("../../../plugins/tidy-html");

describe("RTF-to-HTML route", () => {
	let options;
	let server;

	beforeAll(async () => {
		options = await getConfig();

		server = Fastify()
			.register(embedHtmlImages, options)
			.register(tidyCss)
			.register(tidyHtml);
		server.register(plugin, options);

		await server.ready();
	});

	afterAll(async () => {
		await server.close();
	});

	test("Should return RTF file converted to HTML", async () => {
		const response = await server.inject({
			method: "POST",
			url: "/",
			body: fs.readFileSync("./test_resources/test_files/test-rtf.rtf"),
			headers: {
				"content-type": "application/rtf",
			},
		});

		expect(response.payload).toEqual(
			expect.stringContaining("Ask not what your country can do for you")
		);
		expect(isHtml(response.payload)).toEqual(true);
		expect(response.statusCode).toEqual(200);
	});

	test("Should return 415 error code if file is missing", async () => {
		const response = await server.inject({
			method: "POST",
			url: "/",
			headers: {
				"content-type": "application/rtf",
			},
		});

		expect(response.statusCode).toEqual(415);
		expect(response.statusMessage).toEqual("Unsupported Media Type");
	});

	test("Should return 415 error code if file media type is not supported by route", async () => {
		const response = await server.inject({
			method: "POST",
			url: "/",
			body: fs.readFileSync(
				"./test_resources/test_files/empty-test.html"
			),
			query: {
				lastPageToConvert: 2,
			},
			headers: {
				"content-type": "application/html",
			},
		});

		expect(response.statusCode).toEqual(415);
		expect(response.statusMessage).toEqual("Unsupported Media Type");
	});
});
