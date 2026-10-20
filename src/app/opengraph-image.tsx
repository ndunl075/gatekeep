import { ImageResponse } from "next/og";

export const alt = "gatekeep: stop free-credit farming";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0b0b0d",
          padding: 72,
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              border: "1px solid #3a3a40",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ width: 18, height: 22, border: "3px solid #fff", borderBottom: "none", borderRadius: "9px 9px 0 0" }} />
          </div>
          gatekeep
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 88, fontWeight: 300, letterSpacing: -3, lineHeight: 1.05, maxWidth: 980 }}>
            Your free tier is getting farmed.
          </div>
          <div style={{ fontSize: 30, color: "#8e8ea0" }}>One call at signup. Allow, challenge or block.</div>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 24 }}>
          {[
            ["allow", "#3ecf9e"],
            ["challenge", "#f0b86e"],
            ["block", "#f07a7a"],
          ].map(([t, c]) => (
            <div
              key={t}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 16px",
                border: "1px solid #26262b",
                borderRadius: 8,
                background: "#1a1a1d",
                color: "#c9c9d1",
              }}
            >
              <div style={{ width: 10, height: 10, borderRadius: 10, background: c }} />
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
