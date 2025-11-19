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
import EbayAdmin from "./pages/EbayAdmin";
import ApiAccess from "./pages/ApiAccess";
import Profile from "./pages/Profile";
import MissingCostPrices from "./pages/MissingCostPrices";
import ProblematicOrders from "./pages/ProblematicOrders";
import NotFound from "./pages/NotFound";
import OrderingSection from "./pages/menu/OrderingSection";
import SkuSection from "./pages/menu/SkuSection";
import StockUpdatesSection from "./pages/menu/StockUpdatesSection";
import ManagementSection from "./pages/menu/ManagementSection";
import ToolsSection from "./pages/menu/ToolsSection";
import ErrorHuntingSection from "./pages/menu/ErrorHuntingSection";
import AdministrationSection from "./pages/menu/AdministrationSection";
import PriceHunter from "./pages/PriceHunter";

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
          <Route path="/menu/ordering" element={<OrderingSection />} />
          <Route path="/menu/sku-section" element={<SkuSection />} />
          <Route path="/menu/stock-updates" element={<StockUpdatesSection />} />
          <Route path="/menu/management" element={<ManagementSection />} />
          <Route path="/menu/tools" element={<ToolsSection />} />
          <Route path="/menu/error-hunting" element={<ErrorHuntingSection />} />
          <Route path="/menu/administration" element={<AdministrationSection />} />
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/importing" element={<Importing />} />
            <Route path="/sku-database" element={<SkuDatabase />} />
            <Route path="/brands" element={<Brands />} />
            <Route path="/ebay-admin" element={<EbayAdmin />} />
            <Route path="/api-access" element={<ApiAccess />} />
            <Route path="/user-management" element={<UserManagementPage />} />
            <Route path="/ebay-clone" element={<EbayClone />} />
            <Route path="/price-hunter" element={<PriceHunter />} />
            <Route path="/remote-stock-updates" element={<RemoteStockUpdates />} />
            <Route path="/missing-cost-prices" element={<MissingCostPrices />} />
            <Route path="/problematic-orders" element={<ProblematicOrders />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
