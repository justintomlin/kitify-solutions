import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this project. Without this, Next.js sees the
  // package-lock.json in c:\Users\justo (a separate small npm project) and
  // may infer the wrong root, breaking file tracing. See:
  // https://nextjs.org/docs/app/api-reference/config/next-config-js/output#caveats
  outputFileTracingRoot: path.resolve(process.cwd()),
};

export default nextConfig;
