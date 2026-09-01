export type WorkspaceLocation = {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
};

export type WorkspaceIdentity = {
  id: string;
  name: string;
  employeeCode: string;
  role: string;
  roleCode: string;
  locations: WorkspaceLocation[];
};
