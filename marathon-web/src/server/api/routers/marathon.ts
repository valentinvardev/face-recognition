import { z } from "zod";
import axios from "axios";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { env } from "~/env";
import { findOrCreateRunner } from "~/server/identification";
import { uploadImageBuffer } from "~/server/supabase";
import type { PrismaClient } from "../../../../generated/prisma";

/**
 * For each bib, find the face most likely to belong to the same person.
 * face_locations: [top, right, bottom, left]
 * bibBbox: { x, y, width, height } — Roboflow center-based coords
 *
 * Strategy:
 *  - The face must be ABOVE the bib (face bottom < bib center y)
 *  - The face horizontal center must be within 2× the bib width
 *  - Among candidates, pick the one with the smallest horizontal distance
 */
function findBestFaceForBib(
  bibBbox: any,
  faceLocations: number[][],
  processedFaces: Set<number>,
): number | null {
  const bibCenterX = bibBbox.x as number;
  const bibCenterY = bibBbox.y as number;
  const bibWidth = bibBbox.width as number;

  let bestIdx: number | null = null;
  let bestDist = Infinity;

  for (let i = 0; i < faceLocations.length; i++) {
    if (processedFaces.has(i)) continue;

    const loc = faceLocations[i]!;
    const faceBottom = loc[2] ?? 0;
    const faceLeft   = loc[3] ?? 0;
    const faceRight  = loc[1] ?? 0;
    const faceCenterX = (faceLeft + faceRight) / 2;

    // Face must be above the bib center
    if (faceBottom > bibCenterY) continue;

    // Face must be horizontally aligned with the bib
    const horizDist = Math.abs(faceCenterX - bibCenterX);
    if (horizDist > bibWidth * 2.5) continue;

    if (horizDist < bestDist) {
      bestDist = horizDist;
      bestIdx = i;
    }
  }

  return bestIdx;
}

/**
 * Core processing: takes Modal results + image buffer, saves everything to DB.
 * Shared between processImage and processFromUrl.
 */
async function processResults(
  results: any,
  imageBuffer: Buffer,
  filename: string,
  db: PrismaClient,
) {
  const storedUrl = await uploadImageBuffer(imageBuffer, filename);
  const photo = await db.photo.create({ data: { url: storedUrl } });

  const runnersDetected: any[] = [];
  const processedFaces = new Set<number>();

  const faceLocations: number[][] = results.face_locations ?? [];
  const faceEncodings: number[][] = results.face_encodings ?? [];
  const bibs: any[] = results.roboflow_results?.predictions ?? [];

  console.log(`Processing: ${bibs.length} bib(s), ${faceLocations.length} face(s)`);

  // 1. Process each detected bib
  for (const bib of bibs) {
    const bibNumber =
      bib.bib_text && bib.bib_text !== "Unknown" && bib.bib_text.trim() !== ""
        ? bib.bib_text.trim()
        : undefined;

    console.log(`Bib detected: text="${bib.bib_text}" → bibNumber=${bibNumber ?? "none"} conf=${bib.confidence?.toFixed(2)}`);

    // Find the face that belongs to this bib
    const faceIdx = findBestFaceForBib(bib, faceLocations, processedFaces);
    const faceEncoding = faceIdx !== null ? faceEncodings[faceIdx] : undefined;
    if (faceIdx !== null) processedFaces.add(faceIdx);

    // Skip if we have absolutely no identifying info
    if (!bibNumber && !faceEncoding) {
      console.log("Skipping bib — no readable number and no face found.");
      continue;
    }

    const runner = await findOrCreateRunner({ bibNumber, faceEncoding });
    await db.detection.create({
      data: { runnerId: runner.id, photoId: photo.id, bbox: bib, confidence: bib.confidence },
    });
    runnersDetected.push(runner);
  }

  // 2. Process faces not matched to any bib (unidentified runners in background, etc.)
  for (let i = 0; i < faceEncodings.length; i++) {
    if (processedFaces.has(i)) continue;

    const runner = await findOrCreateRunner({ faceEncoding: faceEncodings[i] });
    await db.detection.create({
      data: {
        runnerId: runner.id,
        photoId: photo.id,
        bbox: { face_loc: faceLocations[i] },
        confidence: 1.0,
      },
    });
    runnersDetected.push(runner);
  }

  return { photoId: photo.id, runnersDetected: runnersDetected.length, runners: runnersDetected };
}

export const marathonRouter = createTRPCRouter({
  processImage: publicProcedure
    .input(z.object({ imageBase64: z.string(), imageUrl: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const modalResponse = await fetch(env.NEXT_PUBLIC_MODAL_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: input.imageBase64 }),
      });
      if (!modalResponse.ok) throw new Error(`Modal API error: ${modalResponse.status}`);
      const results = await modalResponse.json();

      const imageBuffer = Buffer.from(input.imageBase64, "base64");
      const filename = input.imageUrl ?? `upload-${Date.now()}.jpg`;

      return processResults(results, imageBuffer, filename, ctx.db);
    }),

  processFromUrl: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const response = await axios.get(input.url, { responseType: "arraybuffer" });
      const imageBuffer = Buffer.from(response.data as ArrayBuffer);

      const modalResponse = await fetch(env.NEXT_PUBLIC_MODAL_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: imageBuffer.toString("base64") }),
      });
      if (!modalResponse.ok) throw new Error(`Modal API error: ${modalResponse.status}`);
      const results = await modalResponse.json();

      const filename = input.url.split("/").pop() ?? `url-${Date.now()}.jpg`;

      return processResults(results, imageBuffer, filename, ctx.db);
    }),

  getAllRunners: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.runner.findMany({
      include: { detections: { include: { photo: true } } },
      orderBy: { runnerNumber: "asc" },
    });
  }),
});
