import { Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import Board from "./pages/Board";

export default function App() {
   return (
      <Routes>
         <Route path="/" element={<Landing />} />
         <Route path="/board/:username" element={<Board />} />
         <Route path="/join/:hostPeerId" element={<Board />} />
      </Routes>
   );
}
