import assert from "node:assert/strict";

const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
const allowedRegions = (
  process.env.SUPABASE_ALLOWED_REGIONS
  || "ap-southeast-2,ap-southeast-1,ap-northeast-1,ap-northeast-2"
)
  .split(",")
  .map((region) => region.trim())
  .filter(Boolean);

assert(accessToken, "SUPABASE_ACCESS_TOKEN is required");
assert(projectRef, "SUPABASE_PROJECT_REF is required");

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}`, {
  headers: {
    Authorization: `Bearer ${accessToken}`
  }
});

if (!response.ok) {
  throw new Error(`Supabase project verification failed with HTTP ${response.status}`);
}

const project = await response.json();

assert.equal(
  project.ref,
  projectRef,
  "Supabase returned a different project reference"
);
assert(
  allowedRegions.includes(project.region),
  `Production must use an approved Asia-Pacific region; received ${project.region || "no region"}`
);
assert.equal(
  project.status,
  "ACTIVE_HEALTHY",
  `Production project is not healthy: ${project.status || "unknown"}`
);

console.log(`Production project verified: ${project.name} (${project.region})`);
