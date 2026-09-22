import express from "express";
import cors from "cors";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import axios from "axios";
import * as yt from "youtube-search-without-api-key";

const execFileAsync = promisify(execFile);

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// ========================================
// OPEN-WEBSEARCH CLI PATH
// ========================================

const openWebSearchCli = path.join(
  process.cwd(),
  "node_modules",
  "open-websearch",
  "build",
  "index.js"
);

function decodeHtml(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function getHostname(url = "") {
  try {
    return new URL(url).hostname;
  } catch {
    return "bing.com";
  }
}

// ========================================
// MERGED SEARCH API
// TEXT + IMAGE SEARCH
// ========================================

app.get("/api/search", async (req, res) => {
  try {
    const { q } = req.query;

    // ========================================
    // VALIDATE QUERY
    // ========================================

    if (!q || typeof q !== "string" || !q.trim()) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Search query is required",
      });
    }

    const query = q.trim();

    // ========================================
    // TEXT SEARCH
    // ========================================

    const textSearchPromise = (async () => {
      try {
        console.log("TEXT SEARCH:", query);

        /*
          IMPORTANT:

          No:
          --daemon-url

          No:
          npx

          open-websearch will use its direct CLI runtime
          when no local daemon is available.
        */

        const { stdout, stderr } = await execFileAsync(
          process.execPath,
          [
            openWebSearchCli,
            "search",
            query,
            "--engine",
            "duckduckgo",
            "--json",
          ],
          {
            cwd: process.cwd(),
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024,
          }
        );

        if (stderr) {
          console.log("TEXT SEARCH STDERR:", stderr);
        }

        console.log("TEXT SEARCH SUCCESS");

        const searchData = JSON.parse(stdout);

        return {
          success: true,
          status: 200,
          data: searchData.data,
        };
      } catch (error) {
        console.error("========== TEXT SEARCH ERROR ==========");
        console.error("message:", error.message);
        console.error("code:", error.code);
        console.error("stdout:", error.stdout);
        console.error("stderr:", error.stderr);
        console.error("=======================================");

        return {
          success: false,
          status: 500,
          data: null,
          message: "Text search failed",
          error: error.message,
        };
      }
    })();

    // ========================================
    // IMAGE SEARCH - BING IMAGES
    // ========================================

    const imageSearchPromise = (async () => {
      try {
        console.log("IMAGE SEARCH:", query);

        const response = await axios.get(
          "https://www.bing.com/images/async",
          {
            params: {
              q: query,
              qft: "+filterui:imagesize-large",
              safeSearch: "Strict",
              count: 20,
              first: 1,
              mkt: "en-US",
            },

            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/153.0.0.0 Safari/537.36",

              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9," +
                "image/avif,image/webp,*/*;q=0.8",

              "Accept-Language": "en-US,en;q=0.9",

              Referer: "https://www.bing.com/",
            },

            timeout: 15000,
          }
        );

        const html = response.data;

        const results = [];

        // ========================================
        // EXTRACT IMAGE RESULT DATA
        // ========================================

        const regex = /class="iusc"[^>]*m="([^"]+)"/g;

        let match;

        while ((match = regex.exec(html)) !== null) {
          try {
            const metadata = JSON.parse(
              match[1]
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, "&")
            );

            results.push({
              title: metadata.t || "",
              image: metadata.murl || "",
              thumbnail: metadata.turl || "",
              url: metadata.purl || "",
              source: metadata.purl
                ? new URL(metadata.purl).hostname
                : "bing.com",
              width: metadata.w || null,
              height: metadata.h || null,
            });
          } catch (parseError) {
            // Ignore malformed individual result
          }
        }

        // ========================================
        // REMOVE DUPLICATES
        // ========================================

        const uniqueResults = Array.from(
          new Map(
            results
              .filter((item) => item.image)
              .map((item) => [item.image, item])
          ).values()
        );

        console.log(
          "IMAGE SEARCH SUCCESS:",
          uniqueResults.length
        );

        return {
          success: true,
          status: 200,
          totalResults: uniqueResults.length,
          data: uniqueResults.slice(0, 20),
        };
      } catch (error) {
        console.error(
          "========== IMAGE SEARCH ERROR =========="
        );

        console.error("message:", error.message);

        console.error(
          "status:",
          error.response?.status
        );

        console.error(
          "========================================"
        );

        return {
          success: false,
          status: error.response?.status || 500,
          totalResults: 0,
          data: [],
          message: "Image search failed",
          error:
            error.response?.status === 403
              ? "Bing blocked the request"
              : error.message,
        };
      }
    })();

    // ========================================
// VIDEO SEARCH - BING VIDEOS
// ========================================
const videoSearchPromise = (async () => {
  try {
    console.log("YOUTUBE VIDEO SEARCH:", query);

    const results = await yt.search(query);

    const videos = results
      .filter((item) => item.id?.videoId)
      .map((item) => ({
        title: item.snippet?.title || "",
        thumbnail:
          item.snippet?.thumbnails?.high?.url ||
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          "",
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        source: "youtube.com",
        channel: item.snippet?.channelTitle || "",
        publishedAt: item.snippet?.publishedAt || "",
      }));

    const uniqueResults = Array.from(
      new Map(
        videos.map((item) => [item.url, item])
      ).values()
    );

    console.log(
      "YOUTUBE VIDEO SEARCH SUCCESS:",
      uniqueResults.length
    );

    return {
      success: true,
      status: 200,
      totalResults: uniqueResults.length,
      data: uniqueResults,
    };
  } catch (error) {
    console.error(
      "========== YOUTUBE VIDEO SEARCH ERROR =========="
    );
    console.error("message:", error.message);
    console.error(
      "==============================================="
    );

    return {
      success: false,
      status: 500,
      totalResults: 0,
      data: [],
      message: "YouTube video search failed",
      error: error.message,
    };
  }
})();
    // ========================================
    // RUN BOTH IN PARALLEL
    // ========================================



  const [
  textResult,
  imageResult,
  videoResult,
] = await Promise.all([
  textSearchPromise,
  imageSearchPromise,
  videoSearchPromise,
]);

    // ========================================
    // FINAL RESPONSE
    // ========================================

    return res.status(200).json({
  success: true,
  status: 200,
  query,
  text: textResult,
  images: imageResult,
  videos: videoResult,
});
  } catch (error) {
    console.error("========== SEARCH API ERROR ==========");
    console.error("message:", error.message);
    console.error("======================================");

    return res.status(500).json({
      success: false,
      status: 500,
      message: "Search failed",
      error: error.message,
    });
  }
});

app.get("/api/videos", async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Video URL is required",
        data: [],
      });
    }

    const bingUrl = url.startsWith("http")
      ? url
      : `https://www.bing.com${url}`;

    console.log("BING VIDEO URL:", bingUrl);

    const response = await axios.get(bingUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/153.0.0.0 Safari/537.36",

        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9," +
          "image/avif,image/webp,*/*;q=0.8",

        "Accept-Language": "en-US,en;q=0.9",

        Referer: "https://www.bing.com/",
      },

      timeout: 15000,
    });

    const html = response.data;

    console.log("BING HTML LENGTH:", html.length);
    console.log("BING HTML PREVIEW:", html.substring(0, 3000));

    return res.status(200).json({
      success: true,
      status: 200,
      htmlLength: html.length,
      preview: html.substring(0, 3000),
    });
  } catch (error) {
    console.error("VIDEO SEARCH ERROR:", error.message);

    return res.status(error.response?.status || 500).json({
      success: false,
      status: error.response?.status || 500,
      totalResults: 0,
      data: [],
      message: "Video search failed",
      error:
        error.response?.status === 403
          ? "Bing blocked the request"
          : error.message,
    });
  }
});

// ========================================
// LOCAL SERVER
// ========================================

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});