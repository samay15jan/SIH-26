import { useEffect, useRef } from "react";

/**
 * JhanjharMap
 * Drop this component into an existing React/Vite project.
 *
 * Usage:
 *   <JhanjharMap apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY} />
 *
 * The map is intentionally focused on the Jharia/Jhanjhar demonstration area.
 * Adjust JHANJHAR_CENTER and DEFAULT_ZOOM if you have the exact mine coordinates.
 */

const JHANJHAR_CENTER = {
  lat: 23.7407,
  lng: 86.4147,
};

const DEFAULT_ZOOM = 13;

export default function JhanjharMap({
  apiKey,
  height = "520px",
  zoom = DEFAULT_ZOOM,
}) {
  const mapRef = useRef(null);

  useEffect(() => {
    if (!apiKey) {
      console.error(
        "JhanjharMap: Google Maps API key is missing. Set VITE_GOOGLE_MAPS_API_KEY."
      );
      return;
    }

    let cancelled = false;

    const initializeMap = () => {
      if (cancelled || !mapRef.current || !window.google?.maps) return;

      new window.google.maps.Map(mapRef.current, {
        center: JHANJHAR_CENTER,
        zoom,
        mapTypeId: "satellite",
        streetViewControl: false,
        mapTypeControl: true,
        fullscreenControl: true,
        zoomControl: true,
        gestureHandling: "greedy",
      });
    };

    if (window.google?.maps) {
      initializeMap();
      return () => {
        cancelled = true;
      };
    }

    const existingScript = document.querySelector(
      'script[data-google-maps="jhanjhar"]'
    );

    if (existingScript) {
      existingScript.addEventListener("load", initializeMap);
      return () => {
        cancelled = true;
        existingScript.removeEventListener("load", initializeMap);
      };
    }

    const script = document.createElement("script");
    script.dataset.googleMaps = "jhanjhar";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", initializeMap);
    document.head.appendChild(script);

    return () => {
      cancelled = true;
      script.removeEventListener("load", initializeMap);
    };
  }, [apiKey, zoom]);

  if (!apiKey) {
    return (
      <div className="jhanjhar-map-error">
        Google Maps API key missing. Add VITE_GOOGLE_MAPS_API_KEY to your .env file.
      </div>
    );
  }

  return <div ref={mapRef} className="jhanjhar-map" style={{ height }} />;
}
