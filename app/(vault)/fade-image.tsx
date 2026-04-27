"use client";
import { useEffect, useRef, useState } from "react";

export function FadeImage({
  style,
  onLoad,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // Handle already-cached images that won't fire onLoad
  useEffect(() => {
    if (ref.current?.complete) setLoaded(true);
  }, []);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      {...props}
      style={{ ...style, opacity: loaded ? 1 : 0, transition: "opacity 0.3s ease" }}
      onLoad={(e) => {
        setLoaded(true);
        onLoad?.(e);
      }}
    />
  );
}
