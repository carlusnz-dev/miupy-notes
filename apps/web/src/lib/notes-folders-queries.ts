import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth";
import { createFolder, listFolders, updateFolder } from "./notes-folders-api";

export const folderKeys = {
  all: ["folders"] as const,
};

export function useFolders(enabled = true) {
  const signedIn = useAuth().status === "signed-in";
  return useQuery({ queryKey: folderKeys.all, queryFn: ({ signal }) => listFolders(signal), enabled: signedIn && enabled });
}

export function useCreateFolder() {
  const client = useQueryClient();
  return useMutation({ mutationFn: createFolder, onSuccess: () => client.invalidateQueries({ queryKey: folderKeys.all }) });
}

export function useUpdateFolder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof updateFolder>[1]) => updateFolder(id, input),
    onSuccess: () => client.invalidateQueries({ queryKey: folderKeys.all }),
  });
}
