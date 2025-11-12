import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import MainMenu from "./pages/MainMenu";
import Dashboard from "./pages/Dashboard";
import DashboardLayout from "./pages/DashboardLayout";
import Importing from "./pages/Importing";
import SkuDatabase from "./pages/SkuDatabase";
import UserManagementPage from "./pages/UserManagement";
import EbayClone from "./pages/EbayClone";
import RemoteStockUpdates from "./pages/RemoteStockUpdates";
import Brands from "./pages/Brands";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/menu" element={<MainMenu />} />
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/importing" element={<Importing />} />
            <Route path="/sku-database" element={<SkuDatabase />} />
            <Route path="/brands" element={<Brands />} />
            <Route path="/user-management" element={<UserManagementPage />} />
            <Route path="/ebay-clone" element={<EbayClone />} />
            <Route path="/remote-stock-updates" element={<RemoteStockUpdates />} />
          </Route>
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
