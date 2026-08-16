const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");
const yaml = require("js-yaml");

module.exports = function (eleventyConfig) {
  eleventyConfig.addPlugin(syntaxHighlight);

  // Override gray-matter's default YAML engine so it uses js-yaml 4.x
  // (yaml.safeLoad was removed in 4.x; replaced by yaml.load).
  // This is required because the npm override forces gray-matter's bundled
  // js-yaml from 3.14.2 to 4.2.0, which drops the safeLoad/safeDump API.
  eleventyConfig.setFrontMatterParsingOptions({
    engines: {
      yaml: {
        parse: (str) => yaml.load(str),
        stringify: (data) => yaml.dump(data),
      },
    },
  });

  // Passthrough copy: everything that isn't a template
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy({ "src/404.html": "404.html" });
  // index.html is processed through Nunjucks (htmlTemplateEngine: "njk")
  // so it can use dynamic collections (blog post count, etc.)

  // Readable date filter for Nunjucks
  eleventyConfig.addFilter("readableDate", (dateObj) => {
    const d = new Date(dateObj);
    return d.toLocaleDateString("en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  });

  // ISO date string for <time datetime=""> attribute
  eleventyConfig.addFilter("htmlDateString", (dateObj) => {
    const d = new Date(dateObj);
    return d.toISOString().split("T")[0];
  });

  // Split a post collection into series posts (have a part number) vs standalone
  eleventyConfig.addFilter("hasPart", (posts) =>
    (posts || []).filter((p) => p.data && p.data.part != null)
  );
  eleventyConfig.addFilter("noPart", (posts) =>
    (posts || []).filter((p) => p.data && p.data.part == null)
  );

  // Zero-pad a number: {{ 3 | zeroPad }} → "03"
  eleventyConfig.addFilter("zeroPad", (n, width) =>
    String(n).padStart(width || 2, "0")
  );

  return {
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
    },
  };
};
