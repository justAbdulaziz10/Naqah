import { ImageResponse } from "next/og";
import { CAMEL_PATH } from "@/components/brand/CamelMark";

/** Render the approved mark on the install icon's espresso field. */
function renderPwaIcon(size: number, maskable = false) {
  const markSize = maskable ? "60%" : "72%";

  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          backgroundColor: "#29241f",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <svg width={markSize} height={markSize} viewBox="0 0 990 767" xmlns="http://www.w3.org/2000/svg">
          <path d={CAMEL_PATH} fill="#b68a58" transform="translate(0 767) scale(0.1 -0.1)" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: rawSize } = await params;
  const parsedSize = rawSize.endsWith(".png") ? rawSize.slice(0, -4) : "";
  if (parsedSize !== "192" && parsedSize !== "512") return new Response("Not found", { status: 404 });

  const size = Number(parsedSize);
  const maskable = new URL(request.url).searchParams.get("purpose") === "maskable";
  return renderPwaIcon(size, maskable);
}
