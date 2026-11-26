import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api.ts';
import { Layout } from './components/Layout.tsx';
import { Empty, ToastProvider } from './components/ui.tsx';
import { HomePage } from './pages/Home.tsx';
import { TodayPage } from './pages/Today.tsx';
import { ProjectPage, ProjectsPage } from './pages/Projects.tsx';
import { StrategyPage } from './pages/Strategy.tsx';
import { IdeasPage } from './pages/Ideas.tsx';
import { BacklogPage } from './pages/Backlog.tsx';
import { NotePage } from './pages/Note.tsx';
import { FavoritesPage, SettingsPage } from './pages/Settings.tsx';
import { VacancyPage, WorkPage } from './pages/Work.tsx';
import { CompanyPage, ContactPage, ContactsPage } from './pages/Contacts.tsx';
import { DocumentPage, DocumentsPage } from './pages/Documents.tsx';
import { FinancePage } from './pages/Finance.tsx';
import { HealthPage } from './pages/Health.tsx';
import { LearningPage } from './pages/Learning.tsx';
import { PracticesPage } from './pages/Practices.tsx';
import { HouseholdPage } from './pages/Household.tsx';
import { ItemPage } from './pages/Item.tsx';
import { KnowledgeItemPage, KnowledgePage } from './pages/Knowledge.tsx';
import { TravelPage, TripPage } from './pages/Travel.tsx';
import { RelationshipsPage } from './pages/Relationships.tsx';
import { JournalPage } from './pages/Journal.tsx';
import { AssistantPage } from './pages/Assistant.tsx';
import { installShellLinks } from './shell.ts';
import './styles.css';

installShellLinks();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="today" element={<TodayPage />} />
              <Route path="strategy" element={<StrategyPage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/view" element={<ProjectPage />} />
              <Route path="backlog" element={<BacklogPage />} />
              <Route path="ideas" element={<IdeasPage />} />
              <Route path="work" element={<WorkPage />} />
              <Route path="work/view" element={<VacancyPage />} />
              <Route path="contacts" element={<ContactsPage />} />
              <Route path="contacts/view" element={<ContactPage />} />
              <Route path="contacts/company" element={<CompanyPage />} />
              <Route path="documents" element={<DocumentsPage />} />
              <Route path="documents/view" element={<DocumentPage />} />
              <Route path="finance" element={<FinancePage />} />
              <Route path="health" element={<HealthPage />} />
              <Route path="learning" element={<LearningPage />} />
              <Route path="practices" element={<PracticesPage />} />
              <Route path="home" element={<HouseholdPage />} />
              <Route path="knowledge" element={<KnowledgePage />} />
              <Route path="knowledge/view" element={<KnowledgeItemPage />} />
              <Route path="travel" element={<TravelPage />} />
              <Route path="travel/view" element={<TripPage />} />
              <Route path="relationships" element={<RelationshipsPage />} />
              <Route path="journal" element={<JournalPage />} />
              <Route path="assistant" element={<AssistantPage />} />
              <Route path="item" element={<ItemPage />} />
              <Route path="note" element={<NotePage />} />
              <Route path="favorites" element={<FavoritesPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route
                path="*"
                element={
                  <div className="card">
                    <Empty title="Такой страницы нет" action={<Link className="btn small" to="/">На главную</Link>} />
                  </div>
                }
              />
            </Route>
          </Routes>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
