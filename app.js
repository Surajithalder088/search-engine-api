import express from "express";
import cors from "cors";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { imageSearch } from "@mudbill/duckduckgo-images-api";

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
    // IMAGE SEARCH
    // ========================================

    const imageSearchPromise = (async () => {
      try {
        console.log("IMAGE SEARCH:", query);

        const results = await imageSearch({
          query,
          safe: true,
          iterations: 1,
          retries: 2,
        });

        console.log("IMAGE SEARCH SUCCESS:", results.length);

        return {
          success: true,
          status: 200,
          totalResults: results.length,
          data: results.map((item) => ({
            title: item.title,
            image: item.image,
            thumbnail: item.thumbnail,
            url: item.url,
            width: item.width,
            height: item.height,
            source: item.source,
          })),
        };
      } catch (error) {
        console.error("========== IMAGE SEARCH ERROR ==========");
        console.error("message:", error.message);
        console.error("========================================");

        return {
          success: false,
          status: 500,
          totalResults: 0,
          data: [],
          message: "Image search failed",
          error: error.message,
        };
      }
    })();

    // ========================================
    // RUN BOTH IN PARALLEL
    // ========================================

    const [textResult, imageResult] = await Promise.all([
      textSearchPromise,
      imageSearchPromise,
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

// ========================================
// LOCAL SERVER
// ========================================

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});