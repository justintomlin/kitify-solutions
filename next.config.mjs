import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this project. Without this, Next.js sees the
  // package-lock.json in c:\Users\justo (a separate small npm project) and
  // may infer the wrong root, breaking file tracing. See:
  // https://nextjs.org/docs/app/api-reference/config/next-config-js/output#caveats
  outputFileTracingRoot: path.resolve(process.cwd()),

  // Durasein publishes its solid-surface swatches as full-size WordPress uploads with no
  // CDN sizing parameters — the masters run 1–8 MB each, so a 21-tile collection tab would
  // pull ~60 MB if rendered with a plain <img>. Allowlisting the host lets next/image
  // resize and re-encode them to tile size. Only this one host is listed: every other
  // remote image in the portal (Nature Panel's CDN, contractor job photos) either carries
  // its own sizing parameters or comes from an arbitrary origin, and stays on plain <img>.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "durasein.com", pathname: "/us/wp-content/uploads/**" },
    ],
  },
};

export default nextConfig;
