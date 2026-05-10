import { useNavigate } from "react-router-dom";
import { PeerApiHelper } from "../services/PeerApiHelper";
import { clearSession, loadSession } from "../services/session";
import { clearUserFiles } from "../services/fileStore";

export function useLogout() {
   const navigate = useNavigate();
   const session = loadSession();

   return async function logout() {
      if (session) {
         await Promise.all([
            PeerApiHelper.markOffline(session.username).catch(() => {}),
            clearUserFiles(session.username).catch(() => {}),
         ]);
      }
      clearSession();
      navigate("/login", { replace: true });
   };
}
