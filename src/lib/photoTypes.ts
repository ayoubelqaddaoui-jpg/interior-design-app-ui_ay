/**
 * 'permission' = the OS really refused camera access (only possible on native).
 * 'failed'     = the picker or the image could not be read: never reported as a permission problem.
 */
export type PickResult = { uri: string } | { error: 'permission' | 'failed' | 'cancelled' };
export type PickOptions = { preserveTransparency?: boolean };
