import { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';

export interface UseAutocompleteSuggestionsReturn {
  suggestions: google.maps.places.AutocompleteSuggestion[];
  isLoading: boolean;
  resetSession: () => void;
}

/**
 * Hook moderno de Autocomplete usando Places API (New):
 * AutocompleteSuggestion.fetchAutocompleteSuggestions + AutocompleteSessionToken.
 */
export function useAutocompleteSuggestions(
  inputString: string,
  enabled: boolean
): UseAutocompleteSuggestionsReturn {
  const placesLib = useMapsLibrary('places');
  const sessionTokenRef =
    useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const [suggestions, setSuggestions] = useState<
    google.maps.places.AutocompleteSuggestion[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const trimmed = inputString.trim();
    if (!enabled || !placesLib || trimmed.length < 3) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = new AutocompleteSessionToken();
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: trimmed,
        includedRegionCodes: ['us'],
        sessionToken: sessionTokenRef.current ?? undefined,
      })
        .then((res) => {
          if (cancelled) return;
          setSuggestions(res.suggestions ?? []);
          setIsLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setSuggestions([]);
          setIsLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [placesLib, inputString, enabled]);

  return {
    suggestions,
    isLoading,
    resetSession: () => {
      sessionTokenRef.current = null;
      setSuggestions([]);
    },
  };
}
