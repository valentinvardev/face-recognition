import { PrismaClient } from "../generated/prisma";
import axios from "axios";
import { findOrCreateRunner } from "../src/server/identification";

const prisma = new PrismaClient();

const SAMPLE_URLS = [
  "https://source.roboflow.com/SIeSImkutAOurn9hpksv1KzC6xq1/QGaujV3UdOMQSA6lVAC0/thumb.jpg",
  "https://source.roboflow.com/SIeSImkutAOurn9hpksv1KzC6xq1/3CsDdNHkXRbsZ8n6RD48/thumb.jpg",
  "https://source.roboflow.com/SIeSImkutAOurn9hpksv1KzC6xq1/3nuuiVT4tL041EMmWRp0/thumb.jpg",
  "https://source.roboflow.com/SIeSImkutAOurn9hpksv1KzC6xq1/5Ujo3ecg7r5EnzLzcR25/thumb.jpg",
  "https://source.roboflow.com/SIeSImkutAOurn9hpksv1KzC6xq1/F75AFrdDJW2Ssvw6lFtr/thumb.jpg",
  "https://source.roboflow.com/SIeSImkutAOurn9hpksv1KzC6xq1/IkjkLYW9o9WB4tKwivDL/thumb.jpg",
  "https://source.roboflow.com/SIeSImkutAOurn9hpksv1KzC6xq1/McE5Q3P6enid7O7yyQhZ/thumb.jpg",
  "https://source.roboflow.com/SIeSImkutAOurn9hpksv1KzC6xq1/OucioeVsSQLSovV9iExs/thumb.jpg",
  "https://source.roboflow.com/SIeSImkutAOurn9hpksv1KzC6xq1/SxlEFlEVe2iOJ9kSV80M/thumb.jpg",
  "https://source.roboflow.com/SIeSImkutAOurn9hpksv1KzC6xq1/aaOucSi29e3t4XSXha1I/thumb.jpg"
];

const MODAL_ENDPOINT = "https://valentinvardev--marathon-runner-recognition-marathonpipe-999c5c.modal.run";

async function processImage(url: string) {
  console.log(`\n--- Processing: ${url} ---`);
  
  try {
    // 1. Download image and convert to Base64
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const base64 = Buffer.from(response.data, 'binary').toString('base64');

    // 2. Call Modal API
    console.log("Sending to Modal AI...");
    const modalRes = await axios.post(MODAL_ENDPOINT, { image_base64: base64 });
    const results = modalRes.data;

    // 3. Create Photo Record in Supabase
    const photo = await prisma.photo.create({
      data: { url: url }
    });

    // 4. Group & Save Identites
    if (results.face_encodings && results.face_encodings.length > 0) {
      console.log(`Found ${results.face_encodings.length} people. Syncing Identities...`);
      for (let i = 0; i < results.face_encodings.length; i++) {
        const encoding = results.face_encodings[i];
        const bibFound = results.roboflow_results?.predictions?.[i]?.class || null;

        const runner = await findOrCreateRunner({
          bibNumber: bibFound,
          faceEncoding: encoding,
        });

        await prisma.detection.create({
          data: {
            runnerId: runner.id,
            photoId: photo.id,
            bbox: results.roboflow_results?.predictions?.[i] || {},
            confidence: results.roboflow_results?.predictions?.[i]?.confidence || 1.0,
          }
        });
        console.log(`Identified: Runner ${runner.bibNumber || 'Unknown'} (DB ID: ${runner.id.slice(0,8)})`);
      }
    } else {
      console.log("No faces detected in this shot.");
    }
    
  } catch (err: any) {
    console.error(`Failed to process ${url}:`, err.message);
  }
}

async function main() {
  console.log("Starting Bulk Import from Roboflow Dataset...");
  for (const url of SAMPLE_URLS) {
    await processImage(url);
  }
  console.log("\nSuccessfully populated the Runner Library! Check http://localhost:3000/library");
  await prisma.$disconnect();
}

main();
