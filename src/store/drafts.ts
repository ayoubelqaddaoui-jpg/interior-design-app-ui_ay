import type { CollName, DocMap, DocName } from '@/data/types';

/** Unsaved admin edits. The sync loop must never overwrite these with server data. */
export const docBaselines = new Map<DocName, DocMap[DocName]>();
export const collectionBaselines = new Map<CollName, any[]>();
