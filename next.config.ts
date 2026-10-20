import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // The pitch is "POST /check"; the real route lives under the versioned API.
    return [{ source: "/check", destination: "/api/v1/check" }];
  },
};

export default nextConfig;
