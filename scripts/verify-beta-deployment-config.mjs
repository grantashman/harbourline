const mode = process.env.VITE_HARBOURLINE_DEPLOYMENT;
const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim();
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const stagingSupabaseUrl = process.env.VITE_HARBOURLINE_STAGING_SUPABASE_URL?.trim();
const supportEmail = process.env.VITE_HARBOURLINE_SUPPORT_EMAIL?.trim();

if (!["staging", "production"].includes(mode)) {
  throw new Error("VITE_HARBOURLINE_DEPLOYMENT must be staging or production.");
}

if (!supabaseUrl?.startsWith("https://")) {
  throw new Error("VITE_SUPABASE_URL must use HTTPS.");
}

if (!publishableKey || !/^sb_(publishable|anon)_/.test(publishableKey)) {
  throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable or anon key.");
}

if (mode === "production") {
  if (!supportEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) {
    throw new Error("VITE_HARBOURLINE_SUPPORT_EMAIL must be a valid production support address.");
  }

  if (stagingSupabaseUrl && supabaseUrl === stagingSupabaseUrl) {
    throw new Error("Production must not use VITE_HARBOURLINE_STAGING_SUPABASE_URL.");
  }
}

const projectHost = new URL(supabaseUrl).host;
console.log(`Deployment configuration passed: ${mode} (${projectHost})`);
