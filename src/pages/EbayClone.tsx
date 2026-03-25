import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Search, ExternalLink, Sparkles } from "lucide-react";

const EbayClone = () => {
  const { toast } = useToast();
  const [brand, setBrand] = useState("");
  const [modelPartNumber, setModelPartNumber] = useState("");
  const [searchResults, setSearchResults] = useState<any>(null);

  const { mutate: searchEbay, isPending: isSearching } = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('ebay-search', {
        body: { brand, modelPartNumber }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Search failed');
      
      return data;
    },
    onSuccess: (data) => {
      setSearchResults(data.data);
      if (data.cached) {
        toast({
          title: "Cached Results",
          description: "Showing previously searched results",
        });
      } else {
        toast({
          title: "Search Complete",
          description: "Found eBay listings",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Search Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { mutate: generateTitles, isPending: isGeneratingTitles } = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('generate-ebay-titles', {
        body: { 
          brand, 
          modelPartNumber,
          compatibility: searchResults?.compatibility_data 
        }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Title generation failed');
      
      return data.titles;
    },
    onSuccess: (titles) => {
      setSearchResults((prev: any) => ({ ...prev, seo_titles: titles }));
      toast({
        title: "Titles Generated",
        description: `Created ${titles.length} SEO-optimized titles`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Title Generation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!brand || !modelPartNumber) {
      toast({
        title: "Missing Information",
        description: "Please enter both brand and model/part number",
        variant: "destructive",
      });
      return;
    }
    searchEbay();
  };

  const formatPrice = (price: number | null) => {
    if (!price) return "N/A";
    return `£${price.toFixed(2)}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Parts & Pricing Scout</h1>
        <p className="text-white/60 mt-2">
          Find competitive eBay listings and generate SEO titles
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Search eBay Listings</CardTitle>
          <CardDescription>
            Enter brand and model/part number to find pricing and compatibility data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="brand">Brand</Label>
                <Input
                  id="brand"
                  placeholder="e.g., NGK, Bosch, ACDelco"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  disabled={isSearching}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="modelPartNumber">Model/Part Number</Label>
                <Input
                  id="modelPartNumber"
                  placeholder="e.g., BKR6E, 0242229659"
                  value={modelPartNumber}
                  onChange={(e) => setModelPartNumber(e.target.value)}
                  disabled={isSearching}
                />
              </div>
            </div>
            <Button type="submit" disabled={isSearching} className="w-full md:w-auto">
              <Search className="mr-2 h-4 w-4" />
              {isSearching ? "Searching..." : "Search eBay"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {isSearching && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      )}

      {searchResults && !isSearching && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Cheapest Overall Listing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {searchResults.cheapest_overall_price ? (
                  <>
                    <div className="text-3xl font-bold text-primary">
                      {formatPrice(searchResults.cheapest_overall_price)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Item ID: {searchResults.cheapest_overall_item_id}
                    </p>
                    {searchResults.cheapest_overall_url && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={searchResults.cheapest_overall_url} target="_blank" rel="noopener noreferrer">
                          View on eBay <ExternalLink className="ml-2 h-3 w-3" />
                        </a>
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">No listings found</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Your Cheapest Listing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {searchResults.cheapest_own_price ? (
                  <>
                    <div className="text-3xl font-bold text-primary">
                      {formatPrice(searchResults.cheapest_own_price)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Item ID: {searchResults.cheapest_own_item_id}
                    </p>
                    {searchResults.cheapest_own_url && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={searchResults.cheapest_own_url} target="_blank" rel="noopener noreferrer">
                          View on eBay <ExternalLink className="ml-2 h-3 w-3" />
                        </a>
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">No listings from your sellers found</p>
                )}
              </CardContent>
            </Card>
          </div>

          {searchResults.compatibility_data && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Vehicle Compatibility</CardTitle>
                <CardDescription>
                  From Item ID: {searchResults.compatibility_item_id}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {Object.entries(searchResults.compatibility_data.specifics).map(([key, value]: [string, any]) => (
                    <div key={key} className="space-y-1">
                      <p className="text-sm font-medium">{key}</p>
                      <p className="text-sm text-muted-foreground">{Array.isArray(value) ? value.join(', ') : value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                SEO-Optimized Titles
              </CardTitle>
              <CardDescription>
                AI-generated titles following eBay best practices
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!searchResults.seo_titles && (
                <Button 
                  onClick={() => generateTitles()} 
                  disabled={isGeneratingTitles}
                  variant="outline"
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  {isGeneratingTitles ? "Generating..." : "Generate Titles"}
                </Button>
              )}
              
              {searchResults.seo_titles && (
                <div className="space-y-2">
                  {searchResults.seo_titles.map((title: string, index: number) => (
                    <div 
                      key={index}
                      className="p-3 bg-muted rounded-md text-sm font-mono cursor-pointer hover:bg-muted/80 transition-colors"
                      onClick={() => {
                        navigator.clipboard.writeText(title);
                        toast({
                          title: "Copied to Clipboard",
                          description: "Title copied successfully",
                        });
                      }}
                    >
                      {title}
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground mt-2">
                    Click any title to copy to clipboard
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default EbayClone;
