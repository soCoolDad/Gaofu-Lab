import { Routes, Route, Navigate } from 'react-router-dom'
import WorkspaceLayout from './layouts/WorkspaceLayout'
import ChaptersPage from './pages/Chapters'
import EditorPage from './pages/Editor'
import OutlinePage from './pages/Outline'
import VolumesPage from './pages/Volumes'
import CharactersPage from './pages/Characters'
import LocationsPage from './pages/Locations'
import ItemsPage from './pages/Items'
import SkillsPage from './pages/Skills'
import ScenesPage from './pages/Scenes'
import FactionsPage from './pages/Factions'
import SystemsPage from './pages/Systems'
import InspirationsPage from './pages/Inspirations'
import ForeshadowingsPage from './pages/Foreshadowings'
import TimelinePage from './pages/Timeline'
import ModelsPage from './pages/Models'
import SettingsPage from './pages/Settings'
import TokenLogsPage from './pages/TokenLogs'
import ToolsPage from './pages/Tools'
import AgentPage from './pages/Agent'
import SkillManagerPage from './pages/SkillManager'
import RoleDialoguePage from './pages/RoleDialogue'
import ChatRoomPage from './pages/ChatRoom'
import StyleFingerprintPage from './pages/StyleFingerprint'
import BookMemoryPage from './pages/BookMemory'
import WelcomePage from './pages/Welcome/index'
import DisclaimerModal from './components/DisclaimerModal'
import DocModal from './components/DocModal'

export default function App() {
  return (
    <>
    <DisclaimerModal />
    <DocModal />
    <Routes>
      {/* 全局页面：不依赖书籍 */}
      <Route path="/" element={<WorkspaceLayout />}>
        <Route index element={<WelcomePage />} />
        <Route path="models" element={<ModelsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="token-logs" element={<TokenLogsPage />} />
        <Route path="tools" element={<ToolsPage />} />
        <Route path="skills" element={<SkillManagerPage />} />
        <Route path="agent" element={<AgentPage />} />
      </Route>
      {/* 书籍相关页面 */}
      <Route path="/book/:bookId" element={<WorkspaceLayout />}>
        <Route index element={<Navigate to="editor" replace />} />
        <Route path="chapters" element={<ChaptersPage />} />
        <Route path="editor" element={<EditorPage />} />
        <Route path="outline" element={<OutlinePage />} />
        <Route path="volumes" element={<VolumesPage />} />
        <Route path="characters" element={<CharactersPage />} />
        <Route path="locations" element={<LocationsPage />} />
        <Route path="items" element={<ItemsPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="scenes" element={<ScenesPage />} />
        <Route path="factions" element={<FactionsPage />} />
        <Route path="systems" element={<SystemsPage />} />
        <Route path="inspirations" element={<InspirationsPage />} />
        <Route path="foreshadowings" element={<ForeshadowingsPage />} />
        <Route path="timeline" element={<TimelinePage />} />
        <Route path="role-dialogue" element={<RoleDialoguePage />} />
        <Route path="chat-room" element={<ChatRoomPage />} />
        <Route path="style-fingerprint" element={<StyleFingerprintPage />} />
        <Route path="memory" element={<BookMemoryPage />} />
      </Route>
    </Routes>
    </>
  )
}