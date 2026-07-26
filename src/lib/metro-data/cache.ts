// In-process cache of the current metro datasets, one per city.
//
// Holds one active IMetroDataset per city. Derived structures (routing graph, fuzzy-search
// index) are built lazily in their own modules and memoized by dataset object identity
// (WeakMap), so swapping a dataset automatically triggers their rebuild without any
// explicit subscriptions — and each city's dataset gets its own derived structures.

import { IMetroDataset, TMetroCity } from './types.js';

const datasets = new Map<TMetroCity, IMetroDataset>();

/** Sets the active dataset of a city (null clears that city's cache) */
export const setMetroDataset = (city: TMetroCity, dataset: IMetroDataset | null): void => {
  if (dataset) {
    datasets.set(city, dataset);
  } else {
    datasets.delete(city);
  }
};

/** The active dataset of a city or null (defaults to Moscow — the original single-city API) */
export const getMetroDatasetOrNull = (city: TMetroCity = 'moscow'): IMetroDataset | null => datasets.get(city) ?? null;
