// In-process cache of the current metro dataset.
//
// Holds a single active IMetroDataset. Derived structures (routing graph, fuzzy-search
// index) are built lazily in their own modules and memoized by dataset object identity
// (WeakMap), so swapping the dataset automatically triggers their rebuild without any
// explicit subscriptions.

import { IMetroDataset, MetroDataUnavailableError } from './types.js';

let currentDataset: IMetroDataset | null = null;

/** Sets the active dataset (null clears the cache) */
export const setMetroDataset = (dataset: IMetroDataset | null): void => {
  currentDataset = dataset;
};

/** Whether the cache holds data */
export const hasMetroData = (): boolean => currentDataset !== null;

/** The active dataset or null */
export const getMetroDatasetOrNull = (): IMetroDataset | null => currentDataset;

/**
 * The active dataset. If the cache is empty (both sources unavailable and no disk copy),
 * throws MetroDataUnavailableError — the caller must surface this error to the user.
 */
export const getMetroDataset = (): IMetroDataset => {
  if (!currentDataset) {
    throw new MetroDataUnavailableError();
  }
  return currentDataset;
};
