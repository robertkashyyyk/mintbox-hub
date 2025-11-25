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
import PriceHunter from "./pages/PriceHunter";
import ProductDetail from "./pages/ProductDetail";
import IgnoredSellers from "./pages/IgnoredSellers";
import IgnoredListings from "./pages/IgnoredListings";
import SalesOrders from "./pages/SalesOrders";
import AccessDenied from "./components/AccessDenied";

// Module Index Pages
import DiscoveryIndex from "./pages/DiscoveryIndex";
import IntelligenceIndex from "./pages/IntelligenceIndex";
import DecisionsIndex from "./pages/DecisionsIndex";
import ExecutionIndex from "./pages/ExecutionIndex";
import AdminIndex from "./pages/AdminIndex";

// Discovery Pages
import DiscoveryQueue from "./pages/discovery/DiscoveryQueue";

// Intelligence Pages
import VelocityCoverage from "./pages/intelligence/VelocityCoverage";
import StockHealth from "./pages/intelligence/StockHealth";
import PricingSignals from "./pages/intelligence/PricingSignals";
import Seasonality from "./pages/intelligence/Seasonality";

// Decisions Pages
import BuyRecommendations from "./pages/decisions/BuyRecommendations";
import LiquidationCandidates from "./pages/decisions/LiquidationCandidates";
import PriceMoves from "./pages/decisions/PriceMoves";
import BundleSuggestions from "./pages/decisions/BundleSuggestions";

// Admin Pages
import BillingUsage from "./pages/admin/BillingUsage";
import LogsDiagnostics from "./pages/admin/LogsDiagnostics";

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
          <Route path="/access-denied" element={<AccessDenied />} />
          
          {/* Module Index Routes */}
          <Route path="/discovery" element={<DiscoveryIndex />} />
          <Route path="/intelligence" element={<IntelligenceIndex />} />
          <Route path="/decisions" element={<DecisionsIndex />} />
          <Route path="/execution" element={<ExecutionIndex />} />
          <Route path="/admin" element={<AdminIndex />} />
          
          <Route element={<DashboardLayout />}>
            {/* Discovery Sub-Routes */}
            <Route path="/discovery/products" element={<SkuDatabase />} />
            <Route path="/discovery/products/:id" element={<ProductDetail />} />
            <Route path="/discovery/brands" element={<Brands />} />
            <Route path="/discovery/discovery-queue" element={<DiscoveryQueue />} />
            <Route path="/discovery/order-telemetry" element={<SalesOrders />} />
            <Route path="/discovery/feed-imports" element={<Importing />} />

            {/* Intelligence Sub-Routes */}
            <Route path="/intelligence/velocity" element={<VelocityCoverage />} />
            <Route path="/intelligence/stock-health" element={<StockHealth />} />
            <Route path="/intelligence/pricing" element={<PricingSignals />} />
            <Route path="/intelligence/seasonality" element={<Seasonality />} />

            {/* Decisions Sub-Routes */}
            <Route path="/decisions/buy" element={<BuyRecommendations />} />
            <Route path="/decisions/liquidation" element={<LiquidationCandidates />} />
            <Route path="/decisions/price-moves" element={<PriceMoves />} />
            <Route path="/decisions/bundles" element={<BundleSuggestions />} />

            {/* Execution Sub-Routes */}
            <Route path="/execution/purchase-orders" element={<Dashboard />} />
            <Route path="/execution/price-push" element={<PriceHunter />} />
            <Route path="/execution/price-push/ignored-sellers" element={<IgnoredSellers />} />
            <Route path="/execution/price-push/ignored-listings" element={<IgnoredListings />} />
            <Route path="/execution/remote-stock-updates" element={<RemoteStockUpdates />} />
            <Route path="/execution/listing-cloner" element={<EbayClone />} />

            {/* Admin Sub-Routes */}
            <Route path="/admin/users" element={<UserManagementPage />} />
            <Route path="/admin/api-keys" element={<ApiAccess />} />
            <Route path="/admin/billing" element={<BillingUsage />} />
            <Route path="/admin/logs" element={<LogsDiagnostics />} />

            {/* Legacy Pages (Still Accessible) */}
            <Route path="/ebay-admin" element={<EbayAdmin />} />
            <Route path="/missing-cost-prices" element={<MissingCostPrices />} />
            <Route path="/problematic-orders" element={<ProblematicOrders />} />
            <Route path="/profile" element={<Profile />} />
          </Route>

          {/* Legacy Redirects */}
          <Route path="/dashboard" element={<Navigate to="/execution/purchase-orders" replace />} />
          <Route path="/sku-database" element={<Navigate to="/discovery/products" replace />} />
          <Route path="/product/:id" element={<Navigate to="/discovery/products/:id" replace />} />
          <Route path="/brands" element={<Navigate to="/discovery/brands" replace />} />
          <Route path="/importing" element={<Navigate to="/discovery/feed-imports" replace />} />
          <Route path="/sales-orders" element={<Navigate to="/discovery/order-telemetry" replace />} />
          <Route path="/price-hunter" element={<Navigate to="/execution/price-push" replace />} />
          <Route path="/ignored-sellers" element={<Navigate to="/execution/price-push/ignored-sellers" replace />} />
          <Route path="/ignored-listings" element={<Navigate to="/execution/price-push/ignored-listings" replace />} />
          <Route path="/remote-stock-updates" element={<Navigate to="/execution/remote-stock-updates" replace />} />
          <Route path="/ebay-clone" element={<Navigate to="/execution/listing-cloner" replace />} />
          <Route path="/user-management" element={<Navigate to="/admin/users" replace />} />
          <Route path="/api-access" element={<Navigate to="/admin/api-keys" replace />} />

          {/* Old menu section redirects */}
          <Route path="/menu/ordering" element={<Navigate to="/execution" replace />} />
          <Route path="/menu/sku-section" element={<Navigate to="/discovery" replace />} />
          <Route path="/menu/stock-updates" element={<Navigate to="/execution" replace />} />
          <Route path="/menu/management" element={<Navigate to="/admin" replace />} />
          <Route path="/menu/tools" element={<Navigate to="/execution" replace />} />
          <Route path="/menu/error-hunting" element={<Navigate to="/discovery" replace />} />
          <Route path="/menu/administration" element={<Navigate to="/admin" replace />} />

          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
