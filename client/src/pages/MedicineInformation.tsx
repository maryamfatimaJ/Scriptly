import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import * as medicinesApi from "@/api/medicines";

// Medicine search.
//
// Every result comes from the server's indexed catalogue search — nothing
// is filtered from a list held in the browser. Results load a page at a
// time ("Show more"), so a one-letter search never pulls the whole
// catalogue.
//
// Error state is handled explicitly: an earlier version rendered a failed
// (401) request as "No verified record found", an auth failure disguised
// as an empty database.

const PAGE_SIZE = 20;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function MedicineInformation() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const debouncedQuery = useDebounced(query.trim(), 300);
  const enabled = debouncedQuery.length >= 1;

  useEffect(() => {
    // Keep the URL shareable without spamming history on every keystroke.
    setSearchParams(debouncedQuery ? { q: debouncedQuery } : {}, { replace: true });
  }, [debouncedQuery, setSearchParams]);

  const { data, isFetching, isFetchingNextPage, isError, error, refetch, fetchNextPage, hasNextPage } = useInfiniteQuery({
    queryKey: ["medicines", "search", debouncedQuery],
    queryFn: ({ pageParam }) => medicinesApi.searchMedicines(debouncedQuery, pageParam, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled,
    retry: false,
  });

  // Only medicines that really exist in the catalogue are suggested.
  const { data: suggestionData } = useQuery({ queryKey: ["medicines", "suggestions"], queryFn: medicinesApi.getSuggestions });
  const suggestions = suggestionData?.suggestions ?? [];

  const results = data?.pages.flatMap((page) => page.medicines) ?? [];
  const first = data?.pages[0];
  const total = first?.total ?? 0;
  const loadingFirstPage = isFetching && !isFetchingNextPage;

  return (
    <div className="mx-auto max-w-content px-6 py-16 sm:py-20">
      <header className="max-w-2xl">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-forest">Reference</p>
        <h1 className="font-display text-4xl">Medicine information</h1>
        <p className="mt-4 text-charcoal/75">
          Search Pakistani medicines by brand, generic name or active ingredient — even a first letter. Add a
          strength or form to narrow it down, for example "panadol 500 mg tablet". Each medicine page shows sourced
          information and a price lookup, with an honest "unavailable" wherever there is no verified data.
        </p>
      </header>

      <div className="mt-8 max-w-md">
        <label htmlFor="medicine-search" className="sr-only">
          Search medicines
        </label>
        <input
          id="medicine-search"
          type="search"
          placeholder="e.g. Panadol, omeprazole, amlodipine 5 mg…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="field w-full"
          autoComplete="off"
        />
      </div>

      <div className="mt-10 max-w-3xl">
        {!enabled && <p className="text-charcoal/70">Type a medicine name, or just its first letter, to search.</p>}

        {!enabled && suggestions.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray">Try:</span>
            {suggestions.map((s) => (
              <Link
                key={s.id}
                to={`/medicines/${s.id}`}
                className="rounded-capsule border border-charcoal/20 px-4 py-1.5 text-sm text-charcoal transition hover:border-forest hover:bg-mint/30"
              >
                {s.label}
                {s.detail && <span className="text-charcoal/60"> · {s.detail}</span>}
              </Link>
            ))}
          </div>
        )}

        {enabled && loadingFirstPage && <p className="text-charcoal/70">Searching…</p>}

        {/* A real error is shown as a real error — never as "no results". */}
        {enabled && isError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
            <p className="font-medium text-red-800">Search failed</p>
            <p className="mt-1 text-sm text-red-700">
              {error instanceof ApiError ? error.message : "We couldn't reach the medicine database."}
            </p>
            <button
              onClick={() => refetch()}
              className="mt-3 rounded-capsule border border-red-300 px-4 py-1.5 text-sm text-red-800 hover:bg-red-100"
            >
              Try again
            </button>
          </div>
        )}

        {enabled && !loadingFirstPage && !isError && first && results.length === 0 && (
          <div className="rounded-2xl border border-dashed border-charcoal/25 p-6">
            <p className="font-medium text-charcoal">No medicine matches "{debouncedQuery}"</p>
            <p className="mt-1 text-sm text-charcoal/70">
              Scriptly's catalogue contains only medicines imported from a source that permits it, so it does not yet
              cover the whole Pakistani market. Try the generic name (for example "omeprazole" rather than a brand),
              or check{" "}
              <a href="https://www.dra.gov.pk/" target="_blank" rel="noreferrer" className="text-forest underline underline-offset-2">
                DRAP
              </a>{" "}
              directly.
            </p>
          </div>
        )}

        {results.length > 0 && first && (
          <>
            <p className="mb-3 text-sm text-gray">
              {total} result{total === 1 ? "" : "s"}
              {(first.interpreted.strength || first.interpreted.form) && (
                <>
                  {" "}
                  · filtered to{" "}
                  {[first.interpreted.strength, first.interpreted.form].filter(Boolean).join(", ")}
                </>
              )}
            </p>
            <ul className="flex flex-col gap-3">
              {results.map((medicine) => {
                const title = medicine.brandName ?? medicine.genericName;
                return (
                  <li key={medicine.id}>
                    <Link
                      to={`/medicines/${medicine.id}`}
                      className="flex items-center gap-4 rounded-2xl border border-charcoal/10 px-5 py-4 transition hover:border-forest hover:bg-mint/20"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="font-medium text-charcoal">{title}</p>
                          {medicine.countryOrMarket && (
                            <span className="rounded-capsule bg-charcoal/10 px-2.5 py-0.5 text-xs">{medicine.countryOrMarket}</span>
                          )}
                        </div>
                        <p className="mt-0.5 text-sm text-charcoal/65">
                          {[medicine.strength, medicine.formulation, medicine.packSize].filter(Boolean).join(" · ") ||
                            medicine.activeIngredient}
                        </p>
                        {(medicine.activeIngredient !== title || medicine.manufacturer) && (
                          <p className="mt-1 text-xs text-gray">
                            {[medicine.activeIngredient !== title ? medicine.activeIngredient : null, medicine.manufacturer]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {hasNextPage && (
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="mt-6 rounded-capsule border border-charcoal/20 px-5 py-2 text-sm hover:border-forest disabled:opacity-60"
              >
                {isFetchingNextPage ? "Loading…" : `Show more (${total - results.length} remaining)`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
