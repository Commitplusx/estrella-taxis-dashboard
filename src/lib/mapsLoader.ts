const GOOGLE_MAPS_API_KEY = 'AIzaSyAYB_sdCTSE5kLvAz4dDXp3221SdSN91ac';

let mapsPromise: Promise<void> | null = null;

export const loadGoogleMaps = (): Promise<void> => {
  if (window.google?.maps?.Map) {
    return Promise.resolve();
  }

  if (mapsPromise) {
    return mapsPromise;
  }

  mapsPromise = new Promise((resolve, reject) => {
    // Definir callback global
    (window as any).__initGlobalMaps = () => {
      resolve();
    };

    const script = document.createElement('script');
    script.id = 'google-maps-script-global';
    // Removemos la librería 'drawing' que causaba el error y usamos solo geometry y marker
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=marker,geometry&callback=__initGlobalMaps`;
    script.async = true;
    script.defer = true;
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return mapsPromise;
};
