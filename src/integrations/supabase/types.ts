export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          alert_type: Database["public"]["Enums"]["alert_type"]
          created_at: string
          email_id: string
          id: string
          occurred_at: string
          severity: Database["public"]["Enums"]["severity_type"]
        }
        Insert: {
          alert_type: Database["public"]["Enums"]["alert_type"]
          created_at?: string
          email_id: string
          id?: string
          occurred_at: string
          severity?: Database["public"]["Enums"]["severity_type"]
        }
        Update: {
          alert_type?: Database["public"]["Enums"]["alert_type"]
          created_at?: string
          email_id?: string
          id?: string
          occurred_at?: string
          severity?: Database["public"]["Enums"]["severity_type"]
        }
        Relationships: [
          {
            foreignKeyName: "alerts_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "latest_email_per_type"
            referencedColumns: ["email_id"]
          },
        ]
      }
      api_keys: {
        Row: {
          active: boolean | null
          created_at: string | null
          created_by: string | null
          id: string
          key: string
          last_used_at: string | null
          name: string
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          key: string
          last_used_at?: string | null
          name: string
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          key?: string
          last_used_at?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      barcode_types: {
        Row: {
          created_at: string | null
          digit_count: number | null
          id: string
          type_name: string
        }
        Insert: {
          created_at?: string | null
          digit_count?: number | null
          id?: string
          type_name: string
        }
        Update: {
          created_at?: string | null
          digit_count?: number | null
          id?: string
          type_name?: string
        }
        Relationships: []
      }
      brands: {
        Row: {
          base_multiplier: number | null
          created_at: string | null
          family: string | null
          id: string
          name: string
          prefix: string | null
          prefix_style: Database["public"]["Enums"]["prefix_style"] | null
          remote_stock_feed_type:
            | Database["public"]["Enums"]["remote_stock_feed_type"]
            | null
        }
        Insert: {
          base_multiplier?: number | null
          created_at?: string | null
          family?: string | null
          id?: string
          name: string
          prefix?: string | null
          prefix_style?: Database["public"]["Enums"]["prefix_style"] | null
          remote_stock_feed_type?:
            | Database["public"]["Enums"]["remote_stock_feed_type"]
            | null
        }
        Update: {
          base_multiplier?: number | null
          created_at?: string | null
          family?: string | null
          id?: string
          name?: string
          prefix?: string | null
          prefix_style?: Database["public"]["Enums"]["prefix_style"] | null
          remote_stock_feed_type?:
            | Database["public"]["Enums"]["remote_stock_feed_type"]
            | null
        }
        Relationships: []
      }
      download_history: {
        Row: {
          brand_id: string
          download_type: string
          downloaded_at: string | null
          id: string
          user_id: string
        }
        Insert: {
          brand_id: string
          download_type: string
          downloaded_at?: string | null
          id?: string
          user_id: string
        }
        Update: {
          brand_id?: string
          download_type?: string
          downloaded_at?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "download_history_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "download_history_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "download_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ebay_search_cache: {
        Row: {
          brand: string
          cheapest_overall_item_id: string | null
          cheapest_overall_price: number | null
          cheapest_overall_url: string | null
          cheapest_own_item_id: string | null
          cheapest_own_price: number | null
          cheapest_own_url: string | null
          compatibility_data: Json | null
          compatibility_item_id: string | null
          created_at: string
          expires_at: string
          id: string
          model_part_number: string
          search_key: string
          searched_at: string
          seo_titles: string[] | null
        }
        Insert: {
          brand: string
          cheapest_overall_item_id?: string | null
          cheapest_overall_price?: number | null
          cheapest_overall_url?: string | null
          cheapest_own_item_id?: string | null
          cheapest_own_price?: number | null
          cheapest_own_url?: string | null
          compatibility_data?: Json | null
          compatibility_item_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          model_part_number: string
          search_key: string
          searched_at?: string
          seo_titles?: string[] | null
        }
        Update: {
          brand?: string
          cheapest_overall_item_id?: string | null
          cheapest_overall_price?: number | null
          cheapest_overall_url?: string | null
          cheapest_own_item_id?: string | null
          cheapest_own_price?: number | null
          cheapest_own_url?: string | null
          compatibility_data?: Json | null
          compatibility_item_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          model_part_number?: string
          search_key?: string
          searched_at?: string
          seo_titles?: string[] | null
        }
        Relationships: []
      }
      ebay_seller_usernames: {
        Row: {
          active: boolean
          created_at: string
          id: string
          notes: string | null
          updated_at: string
          username: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          updated_at?: string
          username: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          notes?: string | null
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      emails: {
        Row: {
          body: string | null
          created_at: string
          id: string
          labels: string[] | null
          message_id: string
          received_at: string
          sender: string
          subject: string
          thread_id: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          labels?: string[] | null
          message_id: string
          received_at: string
          sender: string
          subject: string
          thread_id: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          labels?: string[] | null
          message_id?: string
          received_at?: string
          sender?: string
          subject?: string
          thread_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ignored_listings: {
        Row: {
          created_at: string
          ebay_item_id: string
          id: string
          reason: string | null
          sku: string | null
        }
        Insert: {
          created_at?: string
          ebay_item_id: string
          id?: string
          reason?: string | null
          sku?: string | null
        }
        Update: {
          created_at?: string
          ebay_item_id?: string
          id?: string
          reason?: string | null
          sku?: string | null
        }
        Relationships: []
      }
      ignored_sellers: {
        Row: {
          brand_id: string | null
          created_at: string
          id: string
          reason: string | null
          seller_username: string
        }
        Insert: {
          brand_id?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          seller_username: string
        }
        Update: {
          brand_id?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          seller_username?: string
        }
        Relationships: [
          {
            foreignKeyName: "ignored_sellers_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ignored_sellers_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
        ]
      }
      import_rules: {
        Row: {
          created_at: string
          description: string
          enabled: boolean
          id: string
          pattern: string
          rule_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          enabled?: boolean
          id?: string
          pattern: string
          rule_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          pattern?: string
          rule_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      ingest_logs: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          source: string
          status: string
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          source?: string
          status?: string
        }
        Relationships: []
      }
      ingest_run_state: {
        Row: {
          id: string
          last_ok_at: string | null
          last_run_at: string | null
          last_status: string | null
          updated_at: string | null
        }
        Insert: {
          id: string
          last_ok_at?: string | null
          last_run_at?: string | null
          last_status?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          last_ok_at?: string | null
          last_run_at?: string | null
          last_status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      mintsoft_settings: {
        Row: {
          base_url: string
          dispatched_status_ids: number[]
          id: boolean
          updated_at: string | null
        }
        Insert: {
          base_url: string
          dispatched_status_ids?: number[]
          id?: boolean
          updated_at?: string | null
        }
        Update: {
          base_url?: string
          dispatched_status_ids?: number[]
          id?: boolean
          updated_at?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          link: string | null
          message: string
          read: boolean | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          link?: string | null
          message: string
          read?: boolean | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          link?: string | null
          message?: string
          read?: boolean | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      order_lines: {
        Row: {
          brand_id: string | null
          channel: string | null
          channel_order_ref: string | null
          created_at: string
          id: number
          line_index: number
          mintsoft_order_id: number
          order_date: string
          qty: number
          sku: string
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          brand_id?: string | null
          channel?: string | null
          channel_order_ref?: string | null
          created_at?: string
          id?: number
          line_index: number
          mintsoft_order_id: number
          order_date: string
          qty: number
          sku: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          brand_id?: string | null
          channel?: string | null
          channel_order_ref?: string | null
          created_at?: string
          id?: number
          line_index?: number
          mintsoft_order_id?: number
          order_date?: string
          qty?: number
          sku?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
        ]
      }
      order_tracking: {
        Row: {
          brand_id: string
          created_at: string | null
          id: string
          order_date: string
          placed: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string | null
          id?: string
          order_date?: string
          placed?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string | null
          id?: string
          order_date?: string
          placed?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_tracking_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_tracking_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_tracking_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      parsed_items: {
        Row: {
          brand_name: string | null
          created_at: string | null
          email_id: string
          id: string
          occurred_at: string
          qty: number | null
          raw: Json | null
          report_type: string
          sku: string
          sku_core: string | null
          warehouse: string | null
        }
        Insert: {
          brand_name?: string | null
          created_at?: string | null
          email_id: string
          id?: string
          occurred_at: string
          qty?: number | null
          raw?: Json | null
          report_type: string
          sku: string
          sku_core?: string | null
          warehouse?: string | null
        }
        Update: {
          brand_name?: string | null
          created_at?: string | null
          email_id?: string
          id?: string
          occurred_at?: string
          qty?: number | null
          raw?: Json | null
          report_type?: string
          sku?: string
          sku_core?: string | null
          warehouse?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parsed_items_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parsed_items_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "latest_email_per_type"
            referencedColumns: ["email_id"]
          },
        ]
      }
      price_hunter_automations: {
        Row: {
          brand_id: string
          brand_name: string
          created_at: string
          enabled: boolean
          id: string
          include_fire_sale_only: boolean
          include_only_in_stock: boolean
          interval_days: number
          last_run_at: string | null
          last_run_sku_count: number | null
          next_run_at: string | null
          updated_at: string
        }
        Insert: {
          brand_id: string
          brand_name: string
          created_at?: string
          enabled?: boolean
          id?: string
          include_fire_sale_only?: boolean
          include_only_in_stock?: boolean
          interval_days: number
          last_run_at?: string | null
          last_run_sku_count?: number | null
          next_run_at?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          brand_name?: string
          created_at?: string
          enabled?: boolean
          id?: string
          include_fire_sale_only?: boolean
          include_only_in_stock?: boolean
          interval_days?: number
          last_run_at?: string | null
          last_run_sku_count?: number | null
          next_run_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_hunter_automations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_hunter_automations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
        ]
      }
      price_hunter_xask_usage: {
        Row: {
          brand_id: string | null
          flowline_name: string
          id: string
          occurred_at: string
          product_id: string | null
          sku: string | null
          source: string
          xasks_used: number
        }
        Insert: {
          brand_id?: string | null
          flowline_name: string
          id?: string
          occurred_at?: string
          product_id?: string | null
          sku?: string | null
          source: string
          xasks_used?: number
        }
        Update: {
          brand_id?: string | null
          flowline_name?: string
          id?: string
          occurred_at?: string
          product_id?: string | null
          sku?: string | null
          source?: string
          xasks_used?: number
        }
        Relationships: [
          {
            foreignKeyName: "price_hunter_xask_usage_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_hunter_xask_usage_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_hunter_xask_usage_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_cache"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_hunter_xask_usage_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_need_ordering"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_hunter_xask_usage_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_needs_enrichment"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      product_category_links: {
        Row: {
          category_id: string
          created_at: string | null
          id: string
          product_id: string
        }
        Insert: {
          category_id: string
          created_at?: string | null
          id?: string
          product_id: string
        }
        Update: {
          category_id?: string
          created_at?: string | null
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_category_links_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_category_links_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_cache"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_category_links_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_need_ordering"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_category_links_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_needs_enrichment"
            referencedColumns: ["id"]
          },
        ]
      }
      products_cache: {
        Row: {
          back_order_qty: number | null
          barcode: string | null
          barcode_type_id: string | null
          cost_price: number | null
          created_at: string | null
          current_stock: number | null
          depth: number | null
          discontinued: boolean | null
          discovered_at: string | null
          discovery_source: string | null
          fire_sale: boolean
          handling_time: number | null
          height: number | null
          id: string
          last_stock_sync: string | null
          length: number | null
          low_stock_alert_level: number | null
          mintsoft_product_id: number | null
          name: string
          on_order: number | null
          ph_brand: string | null
          ph_brand_best_item_id: string | null
          ph_brand_best_price: number | null
          ph_brand_best_seller: string | null
          ph_error_message: string | null
          ph_excluded: boolean
          ph_last_checked_at: string | null
          ph_our_best_item_id: string | null
          ph_our_best_price: number | null
          ph_our_best_seller: string | null
          ph_plain_best_item_id: string | null
          ph_plain_best_price: number | null
          ph_plain_best_seller: string | null
          ph_search_term: string | null
          ph_status: string | null
          sku: string
          suppliers: string | null
          updated_at: string | null
          weight: number | null
        }
        Insert: {
          back_order_qty?: number | null
          barcode?: string | null
          barcode_type_id?: string | null
          cost_price?: number | null
          created_at?: string | null
          current_stock?: number | null
          depth?: number | null
          discontinued?: boolean | null
          discovered_at?: string | null
          discovery_source?: string | null
          fire_sale?: boolean
          handling_time?: number | null
          height?: number | null
          id?: string
          last_stock_sync?: string | null
          length?: number | null
          low_stock_alert_level?: number | null
          mintsoft_product_id?: number | null
          name: string
          on_order?: number | null
          ph_brand?: string | null
          ph_brand_best_item_id?: string | null
          ph_brand_best_price?: number | null
          ph_brand_best_seller?: string | null
          ph_error_message?: string | null
          ph_excluded?: boolean
          ph_last_checked_at?: string | null
          ph_our_best_item_id?: string | null
          ph_our_best_price?: number | null
          ph_our_best_seller?: string | null
          ph_plain_best_item_id?: string | null
          ph_plain_best_price?: number | null
          ph_plain_best_seller?: string | null
          ph_search_term?: string | null
          ph_status?: string | null
          sku: string
          suppliers?: string | null
          updated_at?: string | null
          weight?: number | null
        }
        Update: {
          back_order_qty?: number | null
          barcode?: string | null
          barcode_type_id?: string | null
          cost_price?: number | null
          created_at?: string | null
          current_stock?: number | null
          depth?: number | null
          discontinued?: boolean | null
          discovered_at?: string | null
          discovery_source?: string | null
          fire_sale?: boolean
          handling_time?: number | null
          height?: number | null
          id?: string
          last_stock_sync?: string | null
          length?: number | null
          low_stock_alert_level?: number | null
          mintsoft_product_id?: number | null
          name?: string
          on_order?: number | null
          ph_brand?: string | null
          ph_brand_best_item_id?: string | null
          ph_brand_best_price?: number | null
          ph_brand_best_seller?: string | null
          ph_error_message?: string | null
          ph_excluded?: boolean
          ph_last_checked_at?: string | null
          ph_our_best_item_id?: string | null
          ph_our_best_price?: number | null
          ph_our_best_seller?: string | null
          ph_plain_best_item_id?: string | null
          ph_plain_best_price?: number | null
          ph_plain_best_seller?: string | null
          ph_search_term?: string | null
          ph_status?: string | null
          sku?: string
          suppliers?: string | null
          updated_at?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_cache_barcode_type_id_fkey"
            columns: ["barcode_type_id"]
            isOneToOne: false
            referencedRelation: "barcode_types"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      sync_jobs: {
        Row: {
          brand_id: string
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          items_count: number | null
          report_type: string
          started_at: string | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          brand_id: string
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          items_count?: number | null
          report_type: string
          started_at?: string | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          brand_id?: string
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          items_count?: number | null
          report_type?: string
          started_at?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_jobs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_jobs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_history: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          items_imported: number
          status: string
          upload_name: string
          uploaded_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          items_imported?: number
          status?: string
          upload_name: string
          uploaded_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          items_imported?: number
          status?: string
          upload_name?: string
          uploaded_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_invites: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          used: boolean
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          used?: boolean
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          used?: boolean
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      brands_missing_base_multiplier: {
        Row: {
          base_multiplier: number | null
          created_at: string | null
          family: string | null
          id: string | null
          name: string | null
          prefix: string | null
          prefix_style: Database["public"]["Enums"]["prefix_style"] | null
          remote_stock_feed_type:
            | Database["public"]["Enums"]["remote_stock_feed_type"]
            | null
        }
        Insert: {
          base_multiplier?: number | null
          created_at?: string | null
          family?: string | null
          id?: string | null
          name?: string | null
          prefix?: string | null
          prefix_style?: Database["public"]["Enums"]["prefix_style"] | null
          remote_stock_feed_type?:
            | Database["public"]["Enums"]["remote_stock_feed_type"]
            | null
        }
        Update: {
          base_multiplier?: number | null
          created_at?: string | null
          family?: string | null
          id?: string | null
          name?: string | null
          prefix?: string | null
          prefix_style?: Database["public"]["Enums"]["prefix_style"] | null
          remote_stock_feed_type?:
            | Database["public"]["Enums"]["remote_stock_feed_type"]
            | null
        }
        Relationships: []
      }
      buy_recommendations: {
        Row: {
          avg_weekly_units: number | null
          base_multiplier: number | null
          brand_id: string | null
          on_hand_qty: number | null
          recommended_purchase_qty: number | null
          sku: string | null
          target_stock: number | null
          weeks_of_cover: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
        ]
      }
      latest_email_per_type: {
        Row: {
          alert_type: Database["public"]["Enums"]["alert_type"] | null
          email_id: string | null
          occurred_at: string | null
        }
        Relationships: []
      }
      latest_items_by_brand: {
        Row: {
          brand_name: string | null
          created_at: string | null
          email_id: string | null
          id: string | null
          occurred_at: string | null
          qty: number | null
          raw: Json | null
          report_type: string | null
          sku: string | null
          sku_core: string | null
          warehouse: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parsed_items_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parsed_items_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "latest_email_per_type"
            referencedColumns: ["email_id"]
          },
        ]
      }
      latest_items_per_type: {
        Row: {
          brand_name: string | null
          created_at: string | null
          email_id: string | null
          id: string | null
          occurred_at: string | null
          qty: number | null
          raw: Json | null
          report_type: string | null
          sku: string | null
          sku_core: string | null
          warehouse: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parsed_items_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "emails"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parsed_items_email_id_fkey"
            columns: ["email_id"]
            isOneToOne: false
            referencedRelation: "latest_email_per_type"
            referencedColumns: ["email_id"]
          },
        ]
      }
      products_need_ordering: {
        Row: {
          back_order_qty: number | null
          current_stock: number | null
          id: string | null
          last_stock_sync: string | null
          low_stock_alert_level: number | null
          name: string | null
          on_order: number | null
          quantity_to_order: number | null
          sku: string | null
        }
        Insert: {
          back_order_qty?: number | null
          current_stock?: number | null
          id?: string | null
          last_stock_sync?: string | null
          low_stock_alert_level?: number | null
          name?: string | null
          on_order?: number | null
          quantity_to_order?: never
          sku?: string | null
        }
        Update: {
          back_order_qty?: number | null
          current_stock?: number | null
          id?: string | null
          last_stock_sync?: string | null
          low_stock_alert_level?: number | null
          name?: string | null
          on_order?: number | null
          quantity_to_order?: never
          sku?: string | null
        }
        Relationships: []
      }
      products_needs_enrichment: {
        Row: {
          back_order_qty: number | null
          barcode: string | null
          barcode_type_id: string | null
          cost_price: number | null
          created_at: string | null
          current_stock: number | null
          depth: number | null
          discontinued: boolean | null
          discovered_at: string | null
          discovery_source: string | null
          fire_sale: boolean | null
          handling_time: number | null
          height: number | null
          id: string | null
          last_stock_sync: string | null
          length: number | null
          low_stock_alert_level: number | null
          mintsoft_product_id: number | null
          name: string | null
          on_order: number | null
          ph_brand: string | null
          ph_brand_best_item_id: string | null
          ph_brand_best_price: number | null
          ph_brand_best_seller: string | null
          ph_error_message: string | null
          ph_excluded: boolean | null
          ph_last_checked_at: string | null
          ph_our_best_item_id: string | null
          ph_our_best_price: number | null
          ph_our_best_seller: string | null
          ph_plain_best_item_id: string | null
          ph_plain_best_price: number | null
          ph_plain_best_seller: string | null
          ph_search_term: string | null
          ph_status: string | null
          sku: string | null
          suppliers: string | null
          updated_at: string | null
          weight: number | null
        }
        Insert: {
          back_order_qty?: number | null
          barcode?: string | null
          barcode_type_id?: string | null
          cost_price?: number | null
          created_at?: string | null
          current_stock?: number | null
          depth?: number | null
          discontinued?: boolean | null
          discovered_at?: string | null
          discovery_source?: string | null
          fire_sale?: boolean | null
          handling_time?: number | null
          height?: number | null
          id?: string | null
          last_stock_sync?: string | null
          length?: number | null
          low_stock_alert_level?: number | null
          mintsoft_product_id?: number | null
          name?: string | null
          on_order?: number | null
          ph_brand?: string | null
          ph_brand_best_item_id?: string | null
          ph_brand_best_price?: number | null
          ph_brand_best_seller?: string | null
          ph_error_message?: string | null
          ph_excluded?: boolean | null
          ph_last_checked_at?: string | null
          ph_our_best_item_id?: string | null
          ph_our_best_price?: number | null
          ph_our_best_seller?: string | null
          ph_plain_best_item_id?: string | null
          ph_plain_best_price?: number | null
          ph_plain_best_seller?: string | null
          ph_search_term?: string | null
          ph_status?: string | null
          sku?: string | null
          suppliers?: string | null
          updated_at?: string | null
          weight?: number | null
        }
        Update: {
          back_order_qty?: number | null
          barcode?: string | null
          barcode_type_id?: string | null
          cost_price?: number | null
          created_at?: string | null
          current_stock?: number | null
          depth?: number | null
          discontinued?: boolean | null
          discovered_at?: string | null
          discovery_source?: string | null
          fire_sale?: boolean | null
          handling_time?: number | null
          height?: number | null
          id?: string | null
          last_stock_sync?: string | null
          length?: number | null
          low_stock_alert_level?: number | null
          mintsoft_product_id?: number | null
          name?: string | null
          on_order?: number | null
          ph_brand?: string | null
          ph_brand_best_item_id?: string | null
          ph_brand_best_price?: number | null
          ph_brand_best_seller?: string | null
          ph_error_message?: string | null
          ph_excluded?: boolean | null
          ph_last_checked_at?: string | null
          ph_our_best_item_id?: string | null
          ph_our_best_price?: number | null
          ph_our_best_seller?: string | null
          ph_plain_best_item_id?: string | null
          ph_plain_best_price?: number | null
          ph_plain_best_seller?: string | null
          ph_search_term?: string | null
          ph_status?: string | null
          sku?: string | null
          suppliers?: string | null
          updated_at?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_cache_barcode_type_id_fkey"
            columns: ["barcode_type_id"]
            isOneToOne: false
            referencedRelation: "barcode_types"
            referencedColumns: ["id"]
          },
        ]
      }
      sku_stock_health: {
        Row: {
          avg_weekly_units: number | null
          base_multiplier: number | null
          brand_id: string | null
          health_category: string | null
          on_hand_qty: number | null
          sku: string | null
          weeks_of_cover: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
        ]
      }
      sku_velocity: {
        Row: {
          avg_weekly_units: number | null
          brand_id: string | null
          sku: string | null
          units_30d: number | null
          units_60d: number | null
          units_90d: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      alert_type: "LowStock" | "RemoteStock" | "BackOrders" | "Inventory"
      app_role: "super_user" | "senior_user" | "simple_user"
      prefix_style: "hyphen" | "slash"
      remote_stock_feed_type:
        | "email"
        | "google_sheet"
        | "direct_upload"
        | "ftp_push"
        | "ftp_pull"
        | "no_feed"
      severity_type: "info" | "warning" | "critical"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_type: ["LowStock", "RemoteStock", "BackOrders", "Inventory"],
      app_role: ["super_user", "senior_user", "simple_user"],
      prefix_style: ["hyphen", "slash"],
      remote_stock_feed_type: [
        "email",
        "google_sheet",
        "direct_upload",
        "ftp_push",
        "ftp_pull",
        "no_feed",
      ],
      severity_type: ["info", "warning", "critical"],
    },
  },
} as const
