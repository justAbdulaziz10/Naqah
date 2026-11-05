import { ImageResponse } from "next/og";
import { CAMEL_PATH } from "@/components/brand/CamelMark";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ alignItems: "center", backgroundColor: "#29241f", display: "flex", height: "100%", justifyContent: "center", width: "100%" }}>
        <svg width="72%" height="72%" viewBox="0 0 990 767" xmlns="http://www.w3.org/2000/svg">
          <path d={CAMEL_PATH} fill="#b68a58" transform="translate(0 767) scale(0.1 -0.1)" />
        </svg>
      </div>
    ),
    size,
  );
}
