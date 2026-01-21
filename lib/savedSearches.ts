export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  baseLabelId?: string | null;
  createdAt: string;
  updatedAt?: string;
}
