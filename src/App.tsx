import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import Auth from "./pages/Auth";
import PublicLayout from "./components/public/PublicLayout";
import PublicHome from "./pages/PublicHome";
import PublicAbout from "./pages/PublicAbout";
import PublicProducts from "./pages/PublicProducts";
import PublicTrade from "./pages/PublicTrade";
import PublicContact from "./pages/PublicContact";
import PublicFAQ from "./pages/PublicFAQ";
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
import Settings from "./pages/Settings";
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
import OperationsIndex from "./pages/OperationsIndex";
import DashboardsIndex from "./pages/DashboardsIndex";

// Operations Pages
import OrderMonitoring from "./pages/operations/OrderMonitoring";
import OpsDashboard from "./pages/operations/OpsDashboard";
import OpsReports from "./pages/operations/OpsReports";

// Discovery Pages
import DiscoveryQueue from "./pages/discovery/DiscoveryQueue";
import BulkImageUpload from "./pages/discovery/BulkImageUpload";
import PendingImages from "./pages/discovery/PendingImages";

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
import SystemSettings from "./pages/admin/SystemSettings";
import Integrations from "./pages/admin/Integrations";

// Dashboard Pages
import WarehousePerformance from "./pages/dashboards/WarehousePerformance";
import PackingAreaDisplay from "./pages/dashboards/PackingAreaDisplay";
import WeeklySummary from "./pages/dashboards/WeeklySummary";

// Configure QueryClient with better error handling and retry logic
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry network errors but not 4xx errors
      retry: (failureCount, error) => {
        // Don't retry on auth errors (401, 403)
        if (error && typeof error === 'object' && 'status' in error) {
          const status = (error as { status: number }).status;
          if (status === 401 || status === 403) return false;
        }
        // Retry up to 2 times for other errors
        return failureCount < 2;
      },
      // Stale time of 30 seconds
      staleTime: 30 * 1000,
      // Refetch on window focus
      refetchOnWindowFocus: true,
    },
    mutations: {
      // Don't retry mutations by default
      retry: false,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ErrorBoundary>
        <Toaster />
        <Sonner />
        <BrowserRouter>
        <Routes>
          {/* Public website routes */}
          <Route element={<PublicLayout />}>
            <Route path="/" element={<PublicHome />} />
            <Route path="/about" element={<PublicAbout />} />
            <Route path="/products" element={<PublicProducts />} />
            <Route path="/trade" element={<PublicTrade />} />
            <Route path="/contact" element={<PublicContact />} />
            <Route path="/faq" element={<PublicFAQ />} />
          </Route>
          <Route path="/auth" element={<Auth />} />
          <Route path="/access-denied" element={<AccessDenied />} />
          
          {/* All authenticated routes wrapped in DashboardLayout for sidebar visibility */}
          <Route element={<DashboardLayout />}>
            {/* Main Menu */}
            <Route path="/menu" element={<MainMenu />} />
            
            {/* Module Index Pages */}
            <Route path="/discovery" element={<DiscoveryIndex />} />
            <Route path="/intelligence" element={<IntelligenceIndex />} />
            <Route path="/decisions" element={<DecisionsIndex />} />
            <Route path="/execution" element={<ExecutionIndex />} />
            <Route path="/operations" element={<OperationsIndex />} />
            <Route path="/admin" element={<AdminIndex />} />
            <Route path="/dashboards" element={<DashboardsIndex />} />

            {/* Discovery Sub-Routes */}
            <Route path="/discovery/products" element={<SkuDatabase />} />
            <Route path="/discovery/products/:id" element={<ProductDetail />} />
            <Route path="/discovery/brands" element={<Brands />} />
            <Route path="/discovery/discovery-queue" element={<DiscoveryQueue />} />
            <Route path="/discovery/order-telemetry" element={<SalesOrders />} />
            <Route path="/discovery/feed-imports" element={<Importing />} />
            <Route path="/discovery/bulk-images" element={<BulkImageUpload />} />
            <Route path="/discovery/pending-images" element={<PendingImages />} />

            {/* Intelligence Sub-Routes */}
            <Route path="/intelligence/velocity" element={<VelocityCoverage />} />
            <Route path="/intelligence/stock-health" element={<StockHealth />} />
            <Route path="/intelligence/pricing" element={<PricingSignals />} />
            <Route path="/intelligence/seasonality" element={<Seasonality />} />

            {/* Decisions Sub-Routes */}
            <Route path="/decisions/buying" element={<BuyRecommendations />} />
            <Route path="/decisions/buy" element={<Navigate to="/decisions/buying" replace />} />
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
            <Route path="/admin/settings" element={<SystemSettings />} />
            <Route path="/admin/integrations" element={<Integrations />} />

            {/* Operations Sub-Routes */}
            <Route path="/operations/dashboard" element={<OpsDashboard />} />
            <Route path="/operations/reports" element={<OpsReports />} />
            <Route path="/operations/order-monitoring" element={<OrderMonitoring />} />

            {/* Dashboards Sub-Routes */}
            <Route path="/dashboards/warehouse" element={<WarehousePerformance />} />
            <Route path="/dashboards/packing" element={<PackingAreaDisplay />} />
            <Route path="/dashboards/weekly" element={<WeeklySummary />} />

            {/* Settings & Profile */}
            <Route path="/settings" element={<Settings />} />
            <Route path="/profile" element={<Profile />} />

            {/* Legacy Pages (Still Accessible) */}
            <Route path="/ebay-admin" element={<EbayAdmin />} />
            <Route path="/missing-cost-prices" element={<MissingCostPrices />} />
            <Route path="/problematic-orders" element={<ProblematicOrders />} />
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
      </ErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
