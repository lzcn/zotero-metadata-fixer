export type RetrievalSource = "DOI" | "arXiv" | "PMID" | "URL";
export type Creator = {
  firstName?: string;
  lastName: string;
  creatorType?: string;
  creatorTypeID?: number;
  fieldMode?: number;
};
export type Metadata = {
  itemType: string;
  title: string;
  creators?: Creator[];
  [field: string]: unknown;
};
export interface Item {
  id: number;
  key: string;
  libraryID: number;
  itemType: string;
  itemTypeID: number;
  deleted: boolean;
  isRegularItem(): boolean;
  isEditable(): boolean;
  getField(field: string): string;
  getCreators(): Creator[];
  toJSON(): Metadata;
  setType(type: number): void;
  setField(field: string, value: string): void;
  setCreators(creators: Creator[]): void;
  save(): Promise<unknown>;
  reload(dataTypes: null, reloadUnchanged: boolean): Promise<void>;
}
export type Candidate = {
  source: string;
  title: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
  url?: string;
  bibtex?: string;
  linked?: boolean;
  score?: number;
};
export type Lookup = {
  candidates: Candidate[];
  warnings: string[];
  answered: number;
};
export type Change = { field: string; before: unknown; after: unknown };
export type Plan = {
  itemID: number;
  baseline: string;
  changes: Change[];
};
export interface UpdateHost {
  transaction<T>(run: () => Promise<T>): Promise<T>;
  typeID(type: string): number;
  validField(field: string, typeID: number): boolean;
  validCreator(type: string, typeID: number): boolean;
  creatorTypeName?(typeID: number): string;
  active(): boolean;
}
export type PlanOverrides = {
  itemType?: string;
  removeEditors?: boolean;
  fields?: Record<string, string>;
};
