
import express from "express";
import cors from "cors";
import { exec } from "child_process";
import { promisify } from "util";
import { imageSearch } from "@mudbill/duckduckgo-images-api";

const execAsync = promisify(exec);

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 5000;


// ========================================
// MERGED SEARCH API
// TEXT + IMAGE SEARCH
// ========================================

app.get("/api/search", async (req, res) => {
  try {
    const { q } = req.query;

    // Validate query
    if (!q || !q.trim()) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "Search query is required",
      });
    }

    const query = q.trim();

    // Escape query for command
    const escapedQuery = query.replace(/"/g, '\\"');

    // ========================================
    // TEXT SEARCH
    // ========================================

    const textSearchPromise = (async () => {
      try {
        const command =
          `npx open-websearch search "${escapedQuery}" ` +
          `--engine duckduckgo ` +
          `--json ` +
          `--daemon-url http://127.0.0.1:3210`;

        const { stdout } = await execAsync(command, {
          cwd: process.cwd(),
          windowsHide: true,
          maxBuffer: 10 * 1024 * 1024,
        });

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
        const results = await imageSearch({
          query,
          safe: true,
          iterations: 1,
          retries: 2,
        });

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
    // RUN BOTH SEARCHES IN PARALLEL
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
// START SERVER
// ========================================

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
