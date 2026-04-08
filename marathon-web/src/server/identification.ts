import { db } from "~/server/db";
import { Prisma } from "../../generated/prisma";

/**
 * Calculates Euclidean Distance between two 128-dimensional face encodings.
 */
function calculateFaceDistance(encoding1: number[], encoding2: number[]): number {
  let sumSq = 0;
  for (let i = 0; i < 128; i++) {
    const diff = (encoding1[i] ?? 0) - (encoding2[i] ?? 0);
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq);
}

const FACE_MATCH_THRESHOLD = 0.6;

export async function findOrCreateRunner(data: {
  bibNumber?: string;
  faceEncoding?: number[];
  clothingColor?: string;
}) {
  let matchedRunner = null;

  // 1. Match by Bib Number (Highest Priority)
  // Only match if it's a real number, not "Unknown"
  if (data.bibNumber && data.bibNumber !== "Unknown") {
    matchedRunner = await db.runner.findUnique({
      where: { bibNumber: data.bibNumber },
    });
    if (matchedRunner) {
      console.log(`Matched existing Runner by Bib: ${data.bibNumber}`);
    }
  }

  // 2. Match by Face Similarity (if no Bib match found)
  if (!matchedRunner && data.faceEncoding) {
    const allRunners = await db.runner.findMany();

    let minDistance = Infinity;
    for (const runner of allRunners) {
      if (!runner.faceEncoding) continue;
      const existingEncoding = runner.faceEncoding as number[];
      const distance = calculateFaceDistance(data.faceEncoding, existingEncoding);

      if (distance < minDistance && distance < FACE_MATCH_THRESHOLD) {
        minDistance = distance;
        matchedRunner = runner;
      }
    }
    if (matchedRunner) {
      console.log(`Matched existing Runner by Face (dist: ${minDistance})`);
    }
  }

  // 3. Update or Create
  if (matchedRunner) {
    // Sync missing data (e.g. if we just found the bib for a face-only runner, or vice-versa)
    const updateData: any = {};
    const finalBib = (data.bibNumber && data.bibNumber !== "Unknown") ? data.bibNumber : null;

    if (!matchedRunner.bibNumber && finalBib) updateData.bibNumber = finalBib;
    if (!matchedRunner.faceEncoding && data.faceEncoding) updateData.faceEncoding = data.faceEncoding;
    
    if (Object.keys(updateData).length > 0) {
      console.log(`Enriching Runner profile ${matchedRunner.id} with new data.`);
      return await db.runner.update({
        where: { id: matchedRunner.id },
        data: updateData,
      });
    }
    return matchedRunner;
  }

  // Create new Runner
  console.log("Creating brand new Runner profile.");
  const finalBibForCreate = (data.bibNumber && data.bibNumber !== "Unknown") ? data.bibNumber : null;

  return await db.runner.create({
    data: {
      bibNumber: finalBibForCreate,
      faceEncoding: data.faceEncoding ?? Prisma.JsonNull,
      clothingColor: data.clothingColor || null,
    },
  });
}
