import {requireApiUser} from "../document-builder/auth/api";
import {requireD1} from "../document-builder/storage/runtime";
import {workspaceForUser,workspaceForUserById} from "../platform/workspace";
import {isWorkspaceId} from "../platform/routing";

/** Resolve membership once, including an explicitly selected workspace. Storage
 * operations must additionally enforce ownership of the specific conversation. */
export async function legalChatOwner(request:Request){
  const user=await requireApiUser(request);
  const selected=request.headers.get("x-juro-workspace-id");
  const workspace=selected?(isWorkspaceId(selected)?await workspaceForUserById(user.id,selected):null):await workspaceForUser(user);
  return workspace?{db:requireD1(),workspaceId:workspace.id,userId:user.id}:null;
}
