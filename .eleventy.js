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
  eleventyConfig.addPassthroughCopy({ "src/index.html": "index.html" });
  eleventyConfig.addPassthroughCopy({ "src/404.html": "404.html" });

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
