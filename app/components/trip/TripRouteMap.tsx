"use client";

import dynamic from "next/dynamic";

const TripRouteMapInner = dynamic(() => import("./TripRouteMapInner"), {
  ssr: false,
});

export default TripRouteMapInner;