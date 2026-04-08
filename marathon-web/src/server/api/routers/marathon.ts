import { z } from "zod";
import axios from "axios";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { env } from "~/env";
import { findOrCreateRunner } from "~/server/identification";

/**
 * Simple heuristic to check if a face is likely part of the same person as a bib.
 * Face locations are [top, right, bottom, left].
 * Roboflow bboxes are often [x, y, w, h] or similar depending on the format.
 */
function isFaceNearBib(faceLoc: number[], bibBbox: any): boolean {
  // Modal face_location: [top, right, bottom, left]
  // Roboflow bbox: { x, y, width, height, class, ... }
  if (!bibBbox.x || !bibBbox.y) return false;

  const faceCenterX = (faceLoc[3] + faceLoc[1]) / 2;
  const bibCenterX = bibBbox.x;

  // If centers are horizontally close, it's likely the same person
  const horizontalDist = Math.abs(faceCenterX - bibCenterX);
  return horizontalDist < (bibBbox.width * 1.5); 
}

export const marathonRouter = createTRPCRouter({
  processImage: publicProcedure
    .input(z.object({ imageBase64: z.string(), imageUrl: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const modalResponse = await fetch(env.NEXT_PUBLIC_MODAL_API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_base64: input.imageBase64 }),
        });

        if (!modalResponse.ok) throw new Error("Modal API error");
        const results = await modalResponse.json();

        const photo = await ctx.db.photo.create({
          data: { url: input.imageUrl || "Upload" },
        });

        const runnersDetected = [];
        const processedFaces = new Set<number>();

        // 1. Process Bibs first (High priority)
        const bibs = results.roboflow_results?.predictions || [];
        for (const bib of bibs) {
          // Find matching face (heuristic)
          let matchingFaceEncoding = undefined;
          if (results.face_locations) {
            for (let i = 0; i < results.face_locations.length; i++) {
              if (isFaceNearBib(results.face_locations[i], bib)) {
                matchingFaceEncoding = results.face_encodings[i];
                processedFaces.add(i);
                break;
              }
            }
          }

          const bibNumber = (bib.bib_text && bib.bib_text !== "Unknown" && bib.bib_text.trim() !== "") ? bib.bib_text : undefined;

          const runner = await findOrCreateRunner({
            bibNumber,
            faceEncoding: matchingFaceEncoding,
          });

          await ctx.db.detection.create({
            data: {
              runnerId: runner.id,
              photoId: photo.id,
              bbox: bib,
              confidence: bib.confidence,
            },
          });
          runnersDetected.push(runner);
        }

        // 2. Process remaining Faces (Standalone identities)
        if (results.face_encodings) {
          for (let i = 0; i < results.face_encodings.length; i++) {
            if (processedFaces.has(i)) continue;

            const runner = await findOrCreateRunner({
              faceEncoding: results.face_encodings[i],
            });

            await ctx.db.detection.create({
              data: {
                runnerId: runner.id,
                photoId: photo.id,
                bbox: { face_loc: results.face_locations?.[i] },
                confidence: 1.0,
              },
            });
            runnersDetected.push(runner);
          }
        }

        return { photoId: photo.id, runnersDetected: runnersDetected.length, runners: runnersDetected };
      } catch (err) {
        console.error("Mutation error:", err);
        throw err;
      }
    }),

  processFromUrl: publicProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      // Logic same as above but with URL download
      const response = await axios.get(input.url, { responseType: 'arraybuffer' });
      const imageBase64 = Buffer.from(response.data as ArrayBuffer).toString('base64');
      
      // Call the main logic (internal reuse or duplication for brevity in this simple app)
      // I'll just duplicate for now to ensure it works immediately
      const modalResponse = await fetch(env.NEXT_PUBLIC_MODAL_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: imageBase64 }),
      });
      const results = await modalResponse.json();
      const photo = await ctx.db.photo.create({ data: { url: input.url } });
      const runnersDetected = [];
      const processedFaces = new Set<number>();

      const bibs = results.roboflow_results?.predictions || [];
      for (const bib of bibs) {
        let matchingFaceEncoding = undefined;
        if (results.face_locations) {
          for (let i = 0; i < results.face_locations.length; i++) {
            if (isFaceNearBib(results.face_locations[i], bib)) {
              matchingFaceEncoding = results.face_encodings[i];
              processedFaces.add(i);
              break;
            }
          }
        }
        const bibNumber = (bib.bib_text && bib.bib_text !== "Unknown" && bib.bib_text.trim() !== "") ? bib.bib_text : undefined;
        const runner = await findOrCreateRunner({ bibNumber, faceEncoding: matchingFaceEncoding });
        await ctx.db.detection.create({ data: { runnerId: runner.id, photoId: photo.id, bbox: bib, confidence: bib.confidence } });
        runnersDetected.push(runner);
      }

      if (results.face_encodings) {
        for (let i = 0; i < results.face_encodings.length; i++) {
          if (processedFaces.has(i)) continue;
          const runner = await findOrCreateRunner({ faceEncoding: results.face_encodings[i] });
          await ctx.db.detection.create({ data: { runnerId: runner.id, photoId: photo.id, bbox: { face_loc: results.face_locations?.[i] }, confidence: 1.0 } });
          runnersDetected.push(runner);
        }
      }
      return { photoId: photo.id, runnersDetected: runnersDetected.length, runners: runnersDetected };
    }),

  getAllRunners: publicProcedure.query(async ({ ctx }) => {
    return await ctx.db.runner.findMany({
      include: { detections: { include: { photo: true } } },
      orderBy: { createdAt: "desc" },
    });
  }),
});
