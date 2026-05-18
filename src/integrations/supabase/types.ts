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
      agent_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          run_type: string
          started_at: string | null
          status: string | null
          summary: Json | null
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          run_type: string
          started_at?: string | null
          status?: string | null
          summary?: Json | null
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          run_type?: string
          started_at?: string | null
          status?: string | null
          summary?: Json | null
        }
        Relationships: []
      }
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
      app_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      approved_product_images: {
        Row: {
          approved_at: string
          approved_by: string | null
          brand: string | null
          candidate_id: string
          created_at: string
          height: number | null
          id: string
          original_storage_path: string | null
          part_number: string | null
          processed_storage_path: string | null
          processing_error: string | null
          processing_provider: string
          processing_status: Database["public"]["Enums"]["approved_image_status"]
          processing_version: string
          safety_flags: string[]
          sku: string
          source_image_url: string | null
          updated_at: string
          width: number | null
        }
        Insert: {
          approved_at?: string
          approved_by?: string | null
          brand?: string | null
          candidate_id: string
          created_at?: string
          height?: number | null
          id?: string
          original_storage_path?: string | null
          part_number?: string | null
          processed_storage_path?: string | null
          processing_error?: string | null
          processing_provider?: string
          processing_status?: Database["public"]["Enums"]["approved_image_status"]
          processing_version?: string
          safety_flags?: string[]
          sku: string
          source_image_url?: string | null
          updated_at?: string
          width?: number | null
        }
        Update: {
          approved_at?: string
          approved_by?: string | null
          brand?: string | null
          candidate_id?: string
          created_at?: string
          height?: number | null
          id?: string
          original_storage_path?: string | null
          part_number?: string | null
          processed_storage_path?: string | null
          processing_error?: string | null
          processing_provider?: string
          processing_status?: Database["public"]["Enums"]["approved_image_status"]
          processing_version?: string
          safety_flags?: string[]
          sku?: string
          source_image_url?: string | null
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "approved_product_images_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: true
            referencedRelation: "image_scout_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      backorder_age_snapshot: {
        Row: {
          bo_fresh_0_1: number
          bo_pressure_2_6: number
          bo_rotten_30_plus: number
          bo_serious_14_29: number
          bo_urgent_7_13: number
          capture_date_uk: string
          created_at: string
          id: string
          total_onbackorder: number
        }
        Insert: {
          bo_fresh_0_1?: number
          bo_pressure_2_6?: number
          bo_rotten_30_plus?: number
          bo_serious_14_29?: number
          bo_urgent_7_13?: number
          capture_date_uk: string
          created_at?: string
          id?: string
          total_onbackorder?: number
        }
        Update: {
          bo_fresh_0_1?: number
          bo_pressure_2_6?: number
          bo_rotten_30_plus?: number
          bo_serious_14_29?: number
          bo_urgent_7_13?: number
          capture_date_uk?: string
          created_at?: string
          id?: string
          total_onbackorder?: number
        }
        Relationships: []
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
      brand_image_profile_suggestions: {
        Row: {
          brand_id: string
          id: string
          kind: string
          last_used: string
          promoted: boolean
          success_count: number
          value: string
        }
        Insert: {
          brand_id: string
          id?: string
          kind: string
          last_used?: string
          promoted?: boolean
          success_count?: number
          value: string
        }
        Update: {
          brand_id?: string
          id?: string
          kind?: string
          last_used?: string
          promoted?: boolean
          success_count?: number
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_image_profile_suggestions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_image_profile_suggestions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_image_profiles: {
        Row: {
          blocked_domains: string[]
          brand_id: string
          image_rules: Json
          notes: string | null
          preferred_domains: string[]
          search_templates: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          blocked_domains?: string[]
          brand_id: string
          image_rules?: Json
          notes?: string | null
          preferred_domains?: string[]
          search_templates?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          blocked_domains?: string[]
          brand_id?: string
          image_rules?: Json
          notes?: string | null
          preferred_domains?: string[]
          search_templates?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_image_profiles_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_image_profiles_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          auto_update_lsa: boolean
          base_multiplier: number | null
          created_at: string | null
          family: string | null
          id: string
          image_search_domain: string | null
          image_url_pattern: string | null
          last_lsa_auto_update_at: string | null
          last_lsa_auto_update_summary: Json | null
          name: string
          prefix: string | null
          prefix_style: Database["public"]["Enums"]["prefix_style"] | null
          remote_stock_feed_type:
            | Database["public"]["Enums"]["remote_stock_feed_type"]
            | null
          stock_sync_interval_hours: number
        }
        Insert: {
          auto_update_lsa?: boolean
          base_multiplier?: number | null
          created_at?: string | null
          family?: string | null
          id?: string
          image_search_domain?: string | null
          image_url_pattern?: string | null
          last_lsa_auto_update_at?: string | null
          last_lsa_auto_update_summary?: Json | null
          name: string
          prefix?: string | null
          prefix_style?: Database["public"]["Enums"]["prefix_style"] | null
          remote_stock_feed_type?:
            | Database["public"]["Enums"]["remote_stock_feed_type"]
            | null
          stock_sync_interval_hours?: number
        }
        Update: {
          auto_update_lsa?: boolean
          base_multiplier?: number | null
          created_at?: string | null
          family?: string | null
          id?: string
          image_search_domain?: string | null
          image_url_pattern?: string | null
          last_lsa_auto_update_at?: string | null
          last_lsa_auto_update_summary?: Json | null
          name?: string
          prefix?: string | null
          prefix_style?: Database["public"]["Enums"]["prefix_style"] | null
          remote_stock_feed_type?:
            | Database["public"]["Enums"]["remote_stock_feed_type"]
            | null
          stock_sync_interval_hours?: number
        }
        Relationships: []
      }
      carrier_documents: {
        Row: {
          carrier_id: string
          created_at: string
          doc_type: string
          document_date: string
          file_path: string
          file_size_bytes: number | null
          file_url: string | null
          id: string
          mime_type: string | null
          notes: string | null
          original_filename: string | null
          parse_error: string | null
          parse_status: string
          parsed_at: string | null
          period_end: string | null
          period_start: string | null
          total_amount: number | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          carrier_id: string
          created_at?: string
          doc_type: string
          document_date: string
          file_path: string
          file_size_bytes?: number | null
          file_url?: string | null
          id?: string
          mime_type?: string | null
          notes?: string | null
          original_filename?: string | null
          parse_error?: string | null
          parse_status?: string
          parsed_at?: string | null
          period_end?: string | null
          period_start?: string | null
          total_amount?: number | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          carrier_id?: string
          created_at?: string
          doc_type?: string
          document_date?: string
          file_path?: string
          file_size_bytes?: number | null
          file_url?: string | null
          id?: string
          mime_type?: string | null
          notes?: string | null
          original_filename?: string | null
          parse_error?: string | null
          parse_status?: string
          parsed_at?: string | null
          period_end?: string | null
          period_start?: string | null
          total_amount?: number | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carrier_documents_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_packers: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      carrier_penalties: {
        Row: {
          actual_format: string | null
          carrier_id: string
          created_at: string
          declared_format: string | null
          document_id: string | null
          id: string
          mintsoft_order_id: number | null
          notes: string | null
          penalty_amount: number
          penalty_date: string | null
          reason_code: string | null
          reason_text: string | null
          resolution_status: string
          resolved_at: string | null
          sku: string | null
          tracking_number: string | null
          updated_at: string
        }
        Insert: {
          actual_format?: string | null
          carrier_id: string
          created_at?: string
          declared_format?: string | null
          document_id?: string | null
          id?: string
          mintsoft_order_id?: number | null
          notes?: string | null
          penalty_amount?: number
          penalty_date?: string | null
          reason_code?: string | null
          reason_text?: string | null
          resolution_status?: string
          resolved_at?: string | null
          sku?: string | null
          tracking_number?: string | null
          updated_at?: string
        }
        Update: {
          actual_format?: string | null
          carrier_id?: string
          created_at?: string
          declared_format?: string | null
          document_id?: string | null
          id?: string
          mintsoft_order_id?: number | null
          notes?: string | null
          penalty_amount?: number
          penalty_date?: string | null
          reason_code?: string | null
          reason_text?: string | null
          resolution_status?: string
          resolved_at?: string | null
          sku?: string | null
          tracking_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_penalties_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_penalties_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "carrier_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_reason_codes: {
        Row: {
          active: boolean
          carrier_id: string | null
          code: string
          created_at: string
          description: string | null
          id: string
          label: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          carrier_id?: string | null
          code: string
          created_at?: string
          description?: string | null
          id?: string
          label: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          carrier_id?: string | null
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          label?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_reason_codes_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
        ]
      }
      carrier_remeasure_tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          mintsoft_order_id: number | null
          new_category: string | null
          new_dimensions: Json | null
          notes: string | null
          old_category: string | null
          old_dimensions: Json | null
          penalty_id: string | null
          sku: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          mintsoft_order_id?: number | null
          new_category?: string | null
          new_dimensions?: Json | null
          notes?: string | null
          old_category?: string | null
          old_dimensions?: Json | null
          penalty_id?: string | null
          sku: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          mintsoft_order_id?: number | null
          new_category?: string | null
          new_dimensions?: Json | null
          notes?: string | null
          old_category?: string | null
          old_dimensions?: Json | null
          penalty_id?: string | null
          sku?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carrier_remeasure_tasks_penalty_id_fkey"
            columns: ["penalty_id"]
            isOneToOne: false
            referencedRelation: "carrier_penalties"
            referencedColumns: ["id"]
          },
        ]
      }
      carriers: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      catalogue_items: {
        Row: {
          catalogue_id: string
          created_at: string
          custom_description: string | null
          custom_title: string | null
          display_order: number
          featured: boolean
          id: string
          product_id: string
          updated_at: string
        }
        Insert: {
          catalogue_id: string
          created_at?: string
          custom_description?: string | null
          custom_title?: string | null
          display_order?: number
          featured?: boolean
          id?: string
          product_id: string
          updated_at?: string
        }
        Update: {
          catalogue_id?: string
          created_at?: string
          custom_description?: string | null
          custom_title?: string | null
          display_order?: number
          featured?: boolean
          id?: string
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogue_items_catalogue_id_fkey"
            columns: ["catalogue_id"]
            isOneToOne: false
            referencedRelation: "catalogues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalogue_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_cache"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalogue_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_need_ordering"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalogue_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_needs_enrichment"
            referencedColumns: ["id"]
          },
        ]
      }
      catalogues: {
        Row: {
          brand_id: string | null
          category_id: string | null
          cover_image_url: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          pdf_generated_at: string | null
          pdf_url: string | null
          public_visible: boolean
          published_at: string | null
          slug: string
          status: Database["public"]["Enums"]["catalogue_status"]
          theme: Json
          title: string
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          category_id?: string | null
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          pdf_generated_at?: string | null
          pdf_url?: string | null
          public_visible?: boolean
          published_at?: string | null
          slug: string
          status?: Database["public"]["Enums"]["catalogue_status"]
          theme?: Json
          title: string
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          category_id?: string | null
          cover_image_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          pdf_generated_at?: string | null
          pdf_url?: string | null
          public_visible?: boolean
          published_at?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["catalogue_status"]
          theme?: Json
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogues_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalogues_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalogues_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_fee_rules: {
        Row: {
          active: boolean
          channel_pattern: string
          created_at: string
          fee_pct: number
          fixed_fee: number
          id: string
          name: string
          notes: string | null
          priority: number
          updated_at: string
          vat_rate: number
        }
        Insert: {
          active?: boolean
          channel_pattern: string
          created_at?: string
          fee_pct?: number
          fixed_fee?: number
          id?: string
          name: string
          notes?: string | null
          priority?: number
          updated_at?: string
          vat_rate?: number
        }
        Update: {
          active?: boolean
          channel_pattern?: string
          created_at?: string
          fee_pct?: number
          fixed_fee?: number
          id?: string
          name?: string
          notes?: string | null
          priority?: number
          updated_at?: string
          vat_rate?: number
        }
        Relationships: []
      }
      courier_rates: {
        Row: {
          active: boolean
          cost: number
          courier: string
          created_at: string
          effective_from: string
          id: string
          notes: string | null
          service: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          cost?: number
          courier: string
          created_at?: string
          effective_from?: string
          id?: string
          notes?: string | null
          service: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          cost?: number
          courier?: string
          created_at?: string
          effective_from?: string
          id?: string
          notes?: string | null
          service?: string
          updated_at?: string
        }
        Relationships: []
      }
      despatch_ledger: {
        Row: {
          channel: string | null
          despatched_at: string
          first_seen_at: string
          id: string
          mintsoft_order_id: number
          order_number: string | null
          uk_date: string
        }
        Insert: {
          channel?: string | null
          despatched_at: string
          first_seen_at?: string
          id?: string
          mintsoft_order_id: number
          order_number?: string | null
          uk_date: string
        }
        Update: {
          channel?: string | null
          despatched_at?: string
          first_seen_at?: string
          id?: string
          mintsoft_order_id?: number
          order_number?: string | null
          uk_date?: string
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
      edge_function_runs: {
        Row: {
          created_at: string
          details: Json | null
          duration_ms: number | null
          ended_at: string | null
          function_name: string
          id: number
          message: string | null
          started_at: string
          status: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          duration_ms?: number | null
          ended_at?: string | null
          function_name: string
          id?: number
          message?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          duration_ms?: number | null
          ended_at?: string | null
          function_name?: string
          id?: number
          message?: string | null
          started_at?: string
          status?: string
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
      image_scout_candidate_events: {
        Row: {
          action: string
          candidate_id: string
          created_at: string
          id: string
          new_status:
            | Database["public"]["Enums"]["image_scout_candidate_status"]
            | null
          notes: string | null
          old_status:
            | Database["public"]["Enums"]["image_scout_candidate_status"]
            | null
          user_id: string | null
        }
        Insert: {
          action: string
          candidate_id: string
          created_at?: string
          id?: string
          new_status?:
            | Database["public"]["Enums"]["image_scout_candidate_status"]
            | null
          notes?: string | null
          old_status?:
            | Database["public"]["Enums"]["image_scout_candidate_status"]
            | null
          user_id?: string | null
        }
        Update: {
          action?: string
          candidate_id?: string
          created_at?: string
          id?: string
          new_status?:
            | Database["public"]["Enums"]["image_scout_candidate_status"]
            | null
          notes?: string | null
          old_status?:
            | Database["public"]["Enums"]["image_scout_candidate_status"]
            | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "image_scout_candidate_events_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "image_scout_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      image_scout_candidates: {
        Row: {
          brand_id: string | null
          confidence_reasoning: Json
          confidence_score: number
          created_at: string
          from_template: string | null
          id: string
          image_height: number | null
          image_url: string
          image_width: number | null
          job_id: string | null
          picked: boolean
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          sku: string
          source_domain: string | null
          source_url: string | null
          status: Database["public"]["Enums"]["image_scout_candidate_status"]
        }
        Insert: {
          brand_id?: string | null
          confidence_reasoning?: Json
          confidence_score?: number
          created_at?: string
          from_template?: string | null
          id?: string
          image_height?: number | null
          image_url: string
          image_width?: number | null
          job_id?: string | null
          picked?: boolean
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sku: string
          source_domain?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["image_scout_candidate_status"]
        }
        Update: {
          brand_id?: string | null
          confidence_reasoning?: Json
          confidence_score?: number
          created_at?: string
          from_template?: string | null
          id?: string
          image_height?: number | null
          image_url?: string
          image_width?: number | null
          job_id?: string | null
          picked?: boolean
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sku?: string
          source_domain?: string | null
          source_url?: string | null
          status?: Database["public"]["Enums"]["image_scout_candidate_status"]
        }
        Relationships: [
          {
            foreignKeyName: "image_scout_candidates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "image_scout_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      image_scout_jobs: {
        Row: {
          attempts: number
          brand_id: string | null
          created_at: string
          created_by: string | null
          error: string | null
          finished_at: string | null
          id: string
          mode: string
          override_search_term: string | null
          sku: string
          source_url: string | null
          started_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          brand_id?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          mode: string
          override_search_term?: string | null
          sku: string
          source_url?: string | null
          started_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          brand_id?: string | null
          created_at?: string
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          mode?: string
          override_search_term?: string | null
          sku?: string
          source_url?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_scout_jobs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "image_scout_jobs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
        ]
      }
      image_scout_qa_run_items: {
        Row: {
          best_candidate_url: string | null
          brand: string | null
          candidate_id: string | null
          candidates_found: number
          confidence_score: number | null
          created_at: string
          id: string
          job_id: string | null
          job_outcome: string | null
          part_number: string | null
          processed_storage_path: string | null
          processing_status: string | null
          run_id: string
          safety_flags: string[]
          sku: string
          source_domain: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          best_candidate_url?: string | null
          brand?: string | null
          candidate_id?: string | null
          candidates_found?: number
          confidence_score?: number | null
          created_at?: string
          id?: string
          job_id?: string | null
          job_outcome?: string | null
          part_number?: string | null
          processed_storage_path?: string | null
          processing_status?: string | null
          run_id: string
          safety_flags?: string[]
          sku: string
          source_domain?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          best_candidate_url?: string | null
          brand?: string | null
          candidate_id?: string | null
          candidates_found?: number
          confidence_score?: number | null
          created_at?: string
          id?: string
          job_id?: string | null
          job_outcome?: string | null
          part_number?: string | null
          processed_storage_path?: string | null
          processing_status?: string | null
          run_id?: string
          safety_flags?: string[]
          sku?: string
          source_domain?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_scout_qa_run_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "image_scout_qa_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      image_scout_qa_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          label: string
          notes: string | null
          sku_count: number
          status: string
          summary: Json
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          notes?: string | null
          sku_count?: number
          status?: string
          summary?: Json
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          notes?: string | null
          sku_count?: number
          status?: string
          summary?: Json
          updated_at?: string
        }
        Relationships: []
      }
      image_scout_results: {
        Row: {
          created_at: string
          id: string
          job_id: string | null
          notes: string | null
          outcome: string
          raw_height: number | null
          raw_width: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          sku: string
          source_image_url: string | null
          source_page_url: string | null
          storage_path: string | null
          watermark_score: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          job_id?: string | null
          notes?: string | null
          outcome: string
          raw_height?: number | null
          raw_width?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sku: string
          source_image_url?: string | null
          source_page_url?: string | null
          storage_path?: string | null
          watermark_score?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string | null
          notes?: string | null
          outcome?: string
          raw_height?: number | null
          raw_width?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          sku?: string
          source_image_url?: string | null
          source_page_url?: string | null
          storage_path?: string | null
          watermark_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "image_scout_results_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "image_scout_jobs"
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
      integrations: {
        Row: {
          base_url: string | null
          config: Json
          connection_status: string
          created_at: string
          display_name: string
          enabled: boolean
          error_message: string | null
          id: string
          last_connected_at: string | null
          name: string
          updated_at: string
        }
        Insert: {
          base_url?: string | null
          config?: Json
          connection_status?: string
          created_at?: string
          display_name: string
          enabled?: boolean
          error_message?: string | null
          id?: string
          last_connected_at?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          base_url?: string | null
          config?: Json
          connection_status?: string
          created_at?: string
          display_name?: string
          enabled?: boolean
          error_message?: string | null
          id?: string
          last_connected_at?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      lsa_unmatched_skus: {
        Row: {
          first_seen_at: string
          last_seen_at: string
          lsa: number
          seen_count: number
          sku: string
          source_file: string | null
        }
        Insert: {
          first_seen_at?: string
          last_seen_at?: string
          lsa: number
          seen_count?: number
          sku: string
          source_file?: string | null
        }
        Update: {
          first_seen_at?: string
          last_seen_at?: string
          lsa?: number
          seen_count?: number
          sku?: string
          source_file?: string | null
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
      mintsoft_status_cache: {
        Row: {
          cached_at: string
          external_name: string
          id: string
          status_id: number
        }
        Insert: {
          cached_at?: string
          external_name: string
          id?: string
          status_id: number
        }
        Update: {
          cached_at?: string
          external_name?: string
          id?: string
          status_id?: number
        }
        Relationships: []
      }
      mintsoft_status_snapshots: {
        Row: {
          captured_at: string
          count: number
          id: number
          source: string
          status: string
        }
        Insert: {
          captured_at?: string
          count: number
          id?: number
          source?: string
          status: string
        }
        Update: {
          captured_at?: string
          count?: number
          id?: number
          source?: string
          status?: string
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
      open_asn_items: {
        Row: {
          asn_id: number
          expected_qty: number | null
          id: string
          mintsoft_product_id: number | null
          received_qty: number | null
          sku: string
          synced_at: string | null
        }
        Insert: {
          asn_id: number
          expected_qty?: number | null
          id?: string
          mintsoft_product_id?: number | null
          received_qty?: number | null
          sku: string
          synced_at?: string | null
        }
        Update: {
          asn_id?: number
          expected_qty?: number | null
          id?: string
          mintsoft_product_id?: number | null
          received_qty?: number | null
          sku?: string
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "open_asn_items_asn_id_fkey"
            columns: ["asn_id"]
            isOneToOne: false
            referencedRelation: "open_asns"
            referencedColumns: ["id"]
          },
        ]
      }
      open_asns: {
        Row: {
          asn_status: string | null
          booked_in_date: string | null
          estimated_delivery: string | null
          id: number
          po_reference: string | null
          supplier_id: string | null
          supplier_name: string | null
          synced_at: string | null
          warehouse_id: number | null
        }
        Insert: {
          asn_status?: string | null
          booked_in_date?: string | null
          estimated_delivery?: string | null
          id: number
          po_reference?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          synced_at?: string | null
          warehouse_id?: number | null
        }
        Update: {
          asn_status?: string | null
          booked_in_date?: string | null
          estimated_delivery?: string | null
          id?: number
          po_reference?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          synced_at?: string | null
          warehouse_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "open_asns_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_report_log: {
        Row: {
          error_message: string | null
          id: string
          recipients_count: number
          report_type: string
          sent_at: string
          status: string
          week_ending: string | null
        }
        Insert: {
          error_message?: string | null
          id?: string
          recipients_count?: number
          report_type?: string
          sent_at?: string
          status?: string
          week_ending?: string | null
        }
        Update: {
          error_message?: string | null
          id?: string
          recipients_count?: number
          report_type?: string
          sent_at?: string
          status?: string
          week_ending?: string | null
        }
        Relationships: []
      }
      ops_report_subscribers: {
        Row: {
          created_at: string
          email: string
          enabled: boolean
          id: string
          name: string
          report_type: string
        }
        Insert: {
          created_at?: string
          email: string
          enabled?: boolean
          id?: string
          name: string
          report_type?: string
        }
        Update: {
          created_at?: string
          email?: string
          enabled?: boolean
          id?: string
          name?: string
          report_type?: string
        }
        Relationships: []
      }
      order_issues: {
        Row: {
          assigned_to: string | null
          brand_id: string | null
          created_at: string
          first_problem_seen_at: string
          id: string
          internal_notes: string | null
          is_suppressed: boolean
          issue_status: string
          last_problem_seen_at: string
          line_index: number
          mintsoft_order_id: number
          problem_type: string
          reason: string | null
          resolution_type: string | null
          resolved_at: string | null
          severity: string
          sku: string
          suggested_action: string | null
          suppressed_until: string | null
          suppression_reason: string | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          brand_id?: string | null
          created_at?: string
          first_problem_seen_at?: string
          id?: string
          internal_notes?: string | null
          is_suppressed?: boolean
          issue_status?: string
          last_problem_seen_at?: string
          line_index: number
          mintsoft_order_id: number
          problem_type: string
          reason?: string | null
          resolution_type?: string | null
          resolved_at?: string | null
          severity?: string
          sku: string
          suggested_action?: string | null
          suppressed_until?: string | null
          suppression_reason?: string | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          brand_id?: string | null
          created_at?: string
          first_problem_seen_at?: string
          id?: string
          internal_notes?: string | null
          is_suppressed?: boolean
          issue_status?: string
          last_problem_seen_at?: string
          line_index?: number
          mintsoft_order_id?: number
          problem_type?: string
          reason?: string | null
          resolution_type?: string | null
          resolved_at?: string | null
          severity?: string
          sku?: string
          suggested_action?: string | null
          suppressed_until?: string | null
          suppression_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_issues_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_issues_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
        ]
      }
      order_lines: {
        Row: {
          brand_id: string | null
          channel: string | null
          channel_order_ref: string | null
          courier_service: string | null
          created_at: string
          currency: string | null
          customer_name: string | null
          discount: number | null
          first_seen_at: string | null
          id: number
          last_backordered_at: string | null
          last_seen_at: string | null
          last_status_change_at: string | null
          line_index: number
          line_total: number | null
          mintsoft_order_id: number
          order_date: string
          order_status: string | null
          order_status_id: number | null
          product_name: string | null
          qty: number
          sku: string
          times_seen: number | null
          tracking_number: string | null
          unit_price: number | null
          updated_at: string
          warehouse_id: string | null
          was_backordered: boolean
        }
        Insert: {
          brand_id?: string | null
          channel?: string | null
          channel_order_ref?: string | null
          courier_service?: string | null
          created_at?: string
          currency?: string | null
          customer_name?: string | null
          discount?: number | null
          first_seen_at?: string | null
          id?: number
          last_backordered_at?: string | null
          last_seen_at?: string | null
          last_status_change_at?: string | null
          line_index: number
          line_total?: number | null
          mintsoft_order_id: number
          order_date: string
          order_status?: string | null
          order_status_id?: number | null
          product_name?: string | null
          qty: number
          sku: string
          times_seen?: number | null
          tracking_number?: string | null
          unit_price?: number | null
          updated_at?: string
          warehouse_id?: string | null
          was_backordered?: boolean
        }
        Update: {
          brand_id?: string | null
          channel?: string | null
          channel_order_ref?: string | null
          courier_service?: string | null
          created_at?: string
          currency?: string | null
          customer_name?: string | null
          discount?: number | null
          first_seen_at?: string | null
          id?: number
          last_backordered_at?: string | null
          last_seen_at?: string | null
          last_status_change_at?: string | null
          line_index?: number
          line_total?: number | null
          mintsoft_order_id?: number
          order_date?: string
          order_status?: string | null
          order_status_id?: number | null
          product_name?: string | null
          qty?: number
          sku?: string
          times_seen?: number | null
          tracking_number?: string | null
          unit_price?: number | null
          updated_at?: string
          warehouse_id?: string | null
          was_backordered?: boolean
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
      order_status_history: {
        Row: {
          changed_at: string
          created_at: string
          from_status: string | null
          id: number
          line_index: number
          mintsoft_order_id: number
          to_status: string | null
        }
        Insert: {
          changed_at?: string
          created_at?: string
          from_status?: string | null
          id?: number
          line_index: number
          mintsoft_order_id: number
          to_status?: string | null
        }
        Update: {
          changed_at?: string
          created_at?: string
          from_status?: string | null
          id?: number
          line_index?: number
          mintsoft_order_id?: number
          to_status?: string | null
        }
        Relationships: []
      }
      order_status_snapshots: {
        Row: {
          awaitingpicking_count: number
          capture_date_uk: string
          captured_at: string
          created_at: string
          error_message: string | null
          id: string
          new_count: number
          onbackorder_count: number
          picked_count: number
          run_ok: boolean
          slot: string
        }
        Insert: {
          awaitingpicking_count?: number
          capture_date_uk: string
          captured_at?: string
          created_at?: string
          error_message?: string | null
          id?: string
          new_count?: number
          onbackorder_count?: number
          picked_count?: number
          run_ok?: boolean
          slot: string
        }
        Update: {
          awaitingpicking_count?: number
          capture_date_uk?: string
          captured_at?: string
          created_at?: string
          error_message?: string | null
          id?: string
          new_count?: number
          onbackorder_count?: number
          picked_count?: number
          run_ok?: boolean
          slot?: string
        }
        Relationships: []
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
      pending_images: {
        Row: {
          created_at: string
          file_path: string
          id: string
          promoted_product_id: string | null
          public_url: string
          reviewed_at: string | null
          status: string
          suggested_sku: string
        }
        Insert: {
          created_at?: string
          file_path: string
          id?: string
          promoted_product_id?: string | null
          public_url: string
          reviewed_at?: string | null
          status?: string
          suggested_sku: string
        }
        Update: {
          created_at?: string
          file_path?: string
          id?: string
          promoted_product_id?: string | null
          public_url?: string
          reviewed_at?: string | null
          status?: string
          suggested_sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_images_promoted_product_id_fkey"
            columns: ["promoted_product_id"]
            isOneToOne: false
            referencedRelation: "products_cache"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_images_promoted_product_id_fkey"
            columns: ["promoted_product_id"]
            isOneToOne: false
            referencedRelation: "products_need_ordering"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_images_promoted_product_id_fkey"
            columns: ["promoted_product_id"]
            isOneToOne: false
            referencedRelation: "products_needs_enrichment"
            referencedColumns: ["id"]
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
      product_images: {
        Row: {
          created_at: string
          display_order: number
          file_path: string
          id: string
          is_primary: boolean
          product_id: string
          public_url: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          file_path: string
          id?: string
          is_primary?: boolean
          product_id: string
          public_url: string
        }
        Update: {
          created_at?: string
          display_order?: number
          file_path?: string
          id?: string
          is_primary?: boolean
          product_id?: string
          public_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_cache"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_need_ordering"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
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
          brand_id: string | null
          cost_price: number | null
          cost_price_source: string | null
          cost_price_updated_at: string | null
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
          key_features: string[] | null
          last_stock_sync: string | null
          length: number | null
          low_stock_alert_level: number | null
          marketing_description: string | null
          marketing_title: string | null
          mintsoft_back_orders: number | null
          mintsoft_categories: string[] | null
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
          public_visible: boolean
          quarantined: boolean
          rrp: number | null
          sku: string
          spec_sheet_url: string | null
          suppliers: string | null
          trade_price: number | null
          updated_at: string | null
          weight: number | null
        }
        Insert: {
          back_order_qty?: number | null
          barcode?: string | null
          barcode_type_id?: string | null
          brand_id?: string | null
          cost_price?: number | null
          cost_price_source?: string | null
          cost_price_updated_at?: string | null
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
          key_features?: string[] | null
          last_stock_sync?: string | null
          length?: number | null
          low_stock_alert_level?: number | null
          marketing_description?: string | null
          marketing_title?: string | null
          mintsoft_back_orders?: number | null
          mintsoft_categories?: string[] | null
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
          public_visible?: boolean
          quarantined?: boolean
          rrp?: number | null
          sku: string
          spec_sheet_url?: string | null
          suppliers?: string | null
          trade_price?: number | null
          updated_at?: string | null
          weight?: number | null
        }
        Update: {
          back_order_qty?: number | null
          barcode?: string | null
          barcode_type_id?: string | null
          brand_id?: string | null
          cost_price?: number | null
          cost_price_source?: string | null
          cost_price_updated_at?: string | null
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
          key_features?: string[] | null
          last_stock_sync?: string | null
          length?: number | null
          low_stock_alert_level?: number | null
          marketing_description?: string | null
          marketing_title?: string | null
          mintsoft_back_orders?: number | null
          mintsoft_categories?: string[] | null
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
          public_visible?: boolean
          quarantined?: boolean
          rrp?: number | null
          sku?: string
          spec_sheet_url?: string | null
          suppliers?: string | null
          trade_price?: number | null
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
          {
            foreignKeyName: "products_cache_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_cache_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
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
      profit_weekly_snapshots: {
        Row: {
          aip: number | null
          aov: number | null
          appo: number | null
          appp: number | null
          channel_fees_total: number
          cost_total: number
          courier_cost_total: number
          created_at: string
          dirt_count: number
          good_count: number
          id: string
          iso_week: number
          iso_year: number
          line_count: number
          missing_cost_count: number
          order_count: number
          por_pct: number | null
          profit: number
          qty: number
          revenue: number
          source: string
          updated_at: string
          week_end: string
          week_start: string
        }
        Insert: {
          aip?: number | null
          aov?: number | null
          appo?: number | null
          appp?: number | null
          channel_fees_total?: number
          cost_total?: number
          courier_cost_total?: number
          created_at?: string
          dirt_count?: number
          good_count?: number
          id?: string
          iso_week: number
          iso_year: number
          line_count?: number
          missing_cost_count?: number
          order_count?: number
          por_pct?: number | null
          profit?: number
          qty?: number
          revenue?: number
          source?: string
          updated_at?: string
          week_end: string
          week_start: string
        }
        Update: {
          aip?: number | null
          aov?: number | null
          appo?: number | null
          appp?: number | null
          channel_fees_total?: number
          cost_total?: number
          courier_cost_total?: number
          created_at?: string
          dirt_count?: number
          good_count?: number
          id?: string
          iso_week?: number
          iso_year?: number
          line_count?: number
          missing_cost_count?: number
          order_count?: number
          por_pct?: number | null
          profit?: number
          qty?: number
          revenue?: number
          source?: string
          updated_at?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      purchase_order_lines: {
        Row: {
          created_at: string | null
          id: string
          line_total: number | null
          mintsoft_asn_id: number | null
          notes: string | null
          po_id: string
          product_name: string | null
          qty_ordered: number
          sku: string
          snapshot_back_orders: number | null
          snapshot_live_stock: number | null
          snapshot_low_stock_alert: number | null
          snapshot_on_order: number | null
          unit_cost: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          line_total?: number | null
          mintsoft_asn_id?: number | null
          notes?: string | null
          po_id: string
          product_name?: string | null
          qty_ordered?: number
          sku: string
          snapshot_back_orders?: number | null
          snapshot_live_stock?: number | null
          snapshot_low_stock_alert?: number | null
          snapshot_on_order?: number | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          line_total?: number | null
          mintsoft_asn_id?: number | null
          notes?: string | null
          po_id?: string
          product_name?: string | null
          qty_ordered?: number
          sku?: string
          snapshot_back_orders?: number | null
          snapshot_live_stock?: number | null
          snapshot_low_stock_alert?: number | null
          snapshot_on_order?: number | null
          unit_cost?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          id: string
          mintsoft_asn_reference: string | null
          mintsoft_po_id: number | null
          mintsoft_send_attempted_at: string | null
          mintsoft_send_error: string | null
          notes: string | null
          po_number: string | null
          received_at: string | null
          sent_at: string | null
          sent_by: string | null
          status: string | null
          supplier_id: string | null
          total_cost: number
          total_qty: number
          updated_at: string | null
          warehouse_id: number | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          mintsoft_asn_reference?: string | null
          mintsoft_po_id?: number | null
          mintsoft_send_attempted_at?: string | null
          mintsoft_send_error?: string | null
          notes?: string | null
          po_number?: string | null
          received_at?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string | null
          supplier_id?: string | null
          total_cost?: number
          total_qty?: number
          updated_at?: string | null
          warehouse_id?: number | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          mintsoft_asn_reference?: string | null
          mintsoft_po_id?: number | null
          mintsoft_send_attempted_at?: string | null
          mintsoft_send_error?: string | null
          notes?: string | null
          po_number?: string | null
          received_at?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string | null
          supplier_id?: string | null
          total_cost?: number
          total_qty?: number
          updated_at?: string | null
          warehouse_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      role_area_permissions: {
        Row: {
          area_key: string
          capability: Database["public"]["Enums"]["app_capability"]
          role: Database["public"]["Enums"]["rbac_role"]
        }
        Insert: {
          area_key: string
          capability?: Database["public"]["Enums"]["app_capability"]
          role: Database["public"]["Enums"]["rbac_role"]
        }
        Update: {
          area_key?: string
          capability?: Database["public"]["Enums"]["app_capability"]
          role?: Database["public"]["Enums"]["rbac_role"]
        }
        Relationships: [
          {
            foreignKeyName: "role_area_permissions_area_key_fkey"
            columns: ["area_key"]
            isOneToOne: false
            referencedRelation: "menu_for_user"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "role_area_permissions_area_key_fkey"
            columns: ["area_key"]
            isOneToOne: false
            referencedRelation: "system_areas"
            referencedColumns: ["key"]
          },
        ]
      }
      role_conflicts: {
        Row: {
          reason: string
          role_a: Database["public"]["Enums"]["rbac_role"]
          role_b: Database["public"]["Enums"]["rbac_role"]
        }
        Insert: {
          reason: string
          role_a: Database["public"]["Enums"]["rbac_role"]
          role_b: Database["public"]["Enums"]["rbac_role"]
        }
        Update: {
          reason?: string
          role_a?: Database["public"]["Enums"]["rbac_role"]
          role_b?: Database["public"]["Enums"]["rbac_role"]
        }
        Relationships: []
      }
      sku_prefixes: {
        Row: {
          notes: string | null
          prefix: string
          prefix_style: string | null
          supplier_id: string | null
        }
        Insert: {
          notes?: string | null
          prefix: string
          prefix_style?: string | null
          supplier_id?: string | null
        }
        Update: {
          notes?: string | null
          prefix?: string
          prefix_style?: string | null
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sku_prefixes_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          active: boolean | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          id: string
          lead_time_days: number | null
          mintsoft_supplier_id: number | null
          name: string
          notes: string | null
          ordering_method: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id: string
          lead_time_days?: number | null
          mintsoft_supplier_id?: number | null
          name: string
          notes?: string | null
          ordering_method?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          lead_time_days?: number | null
          mintsoft_supplier_id?: number | null
          name?: string
          notes?: string | null
          ordering_method?: string | null
          updated_at?: string | null
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
      system_areas: {
        Row: {
          icon_name: string | null
          is_menu_item: boolean
          key: string
          label: string
          parent_key: string | null
          route_path: string | null
          sort_order: number
        }
        Insert: {
          icon_name?: string | null
          is_menu_item?: boolean
          key: string
          label: string
          parent_key?: string | null
          route_path?: string | null
          sort_order?: number
        }
        Update: {
          icon_name?: string | null
          is_menu_item?: boolean
          key?: string
          label?: string
          parent_key?: string | null
          route_path?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "system_areas_parent_key_fkey"
            columns: ["parent_key"]
            isOneToOne: false
            referencedRelation: "menu_for_user"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "system_areas_parent_key_fkey"
            columns: ["parent_key"]
            isOneToOne: false
            referencedRelation: "system_areas"
            referencedColumns: ["key"]
          },
        ]
      }
      threeds_reprice_pushes: {
        Row: {
          csv_preview: string | null
          error_message: string | null
          id: string
          pushed_at: string
          pushed_by: string | null
          row_count: number
          sftp_path: string | null
          status: string
          store_id: string
        }
        Insert: {
          csv_preview?: string | null
          error_message?: string | null
          id?: string
          pushed_at?: string
          pushed_by?: string | null
          row_count?: number
          sftp_path?: string | null
          status?: string
          store_id: string
        }
        Update: {
          csv_preview?: string | null
          error_message?: string | null
          id?: string
          pushed_at?: string
          pushed_by?: string | null
          row_count?: number
          sftp_path?: string | null
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "threeds_reprice_pushes_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "threeds_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      threeds_stores: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          mintsoft_channel: string
          sftp_filename: string
          store_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          mintsoft_channel: string
          sftp_filename: string
          store_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          mintsoft_channel?: string
          sftp_filename?: string
          store_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      upload_history: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          items_imported: number
          prefix: string | null
          source: string
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
          prefix?: string | null
          source?: string
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
          prefix?: string | null
          source?: string
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
      user_rbac_roles: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["rbac_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          role: Database["public"]["Enums"]["rbac_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["rbac_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_rbac_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "products_cache_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_cache_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
        ]
      }
      image_scout_duplicate_images: {
        Row: {
          candidate_count: number | null
          image_url: string | null
          sku_count: number | null
          skus: string[] | null
        }
        Relationships: []
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
      lsa_brand_summary: {
        Row: {
          brand_id: string | null
          brand_name: string | null
          critical: number | null
          excess: number | null
          high: number | null
          low: number | null
          refreshed_at: string | null
          target: number | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_cache_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_cache_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_for_user: {
        Row: {
          capability: Database["public"]["Enums"]["app_capability"] | null
          icon_name: string | null
          key: string | null
          label: string | null
          parent_key: string | null
          route_path: string | null
          sort_order: number | null
        }
        Insert: {
          capability?: never
          icon_name?: string | null
          key?: string | null
          label?: string | null
          parent_key?: string | null
          route_path?: string | null
          sort_order?: number | null
        }
        Update: {
          capability?: never
          icon_name?: string | null
          key?: string | null
          label?: string | null
          parent_key?: string | null
          route_path?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "system_areas_parent_key_fkey"
            columns: ["parent_key"]
            isOneToOne: false
            referencedRelation: "menu_for_user"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "system_areas_parent_key_fkey"
            columns: ["parent_key"]
            isOneToOne: false
            referencedRelation: "system_areas"
            referencedColumns: ["key"]
          },
        ]
      }
      ops_backorder_daily_delta: {
        Row: {
          bo_fresh_0_1: number | null
          bo_pressure_2_6: number | null
          bo_rotten_30_plus: number | null
          bo_serious_14_29: number | null
          bo_urgent_7_13: number | null
          capture_date_uk: string | null
          created_at: string | null
          delta_fresh: number | null
          delta_pressure: number | null
          delta_rotten: number | null
          delta_serious: number | null
          delta_total: number | null
          delta_urgent: number | null
          total_onbackorder: number | null
        }
        Relationships: []
      }
      ops_backorder_weekly_summary: {
        Row: {
          current_rotten: number | null
          current_serious: number | null
          current_total: number | null
          current_urgent: number | null
          net_change: number | null
          week_end: string | null
          week_start: string | null
          week_start_rotten: number | null
          week_start_serious: number | null
          week_start_total: number | null
          week_start_urgent: number | null
        }
        Relationships: []
      }
      ops_exceptions_today: {
        Row: {
          backorders_rising_trend: boolean | null
          picking_not_cleared: boolean | null
          rotten_increased: boolean | null
          serious_increased: boolean | null
        }
        Relationships: []
      }
      order_line_economics: {
        Row: {
          brand_id: string | null
          channel: string | null
          channel_fee: number | null
          cost_each: number | null
          courier: string | null
          courier_cost: number | null
          courier_service: string | null
          currency: string | null
          fee_rule_name: string | null
          good_dirt: string | null
          id: number | null
          iso_week: number | null
          iso_year: number | null
          line_index: number | null
          lines_in_order: number | null
          mintsoft_order_id: number | null
          missing_cost: boolean | null
          order_date: string | null
          order_status: string | null
          order_value: number | null
          por_pct: number | null
          price: number | null
          product_name: string | null
          profit: number | null
          qty: number | null
          sku: string | null
          week_start: string | null
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
      order_status_snapshot_latest: {
        Row: {
          awaitingpicking_count: number | null
          capture_date_uk: string | null
          captured_at: string | null
          new_count: number | null
          onbackorder_count: number | null
          picked_count: number | null
          slot: string | null
        }
        Relationships: []
      }
      order_status_snapshot_today: {
        Row: {
          am_awaitingpicking: number | null
          am_captured_at: string | null
          am_new: number | null
          am_onbackorder: number | null
          am_picked: number | null
          date_uk: string | null
          delta_awaitingpicking: number | null
          delta_new: number | null
          delta_onbackorder: number | null
          delta_picked: number | null
          pm_awaitingpicking: number | null
          pm_captured_at: string | null
          pm_new: number | null
          pm_onbackorder: number | null
          pm_picked: number | null
        }
        Relationships: []
      }
      order_telemetry_open_lines: {
        Row: {
          bounce_back_count: number | null
          brand_id: string | null
          brand_name: string | null
          channel: string | null
          channel_order_ref: string | null
          current_stock: number | null
          customer_name: string | null
          days_on_backorder: number | null
          id: number | null
          last_backordered_at: string | null
          last_status_change_at: string | null
          line_index: number | null
          mintsoft_order_id: number | null
          on_active_po: boolean | null
          on_order_qty: number | null
          order_date: string | null
          order_status: string | null
          order_status_id: number | null
          problem_kind: string | null
          product_name: string | null
          qty: number | null
          sku: string | null
          warehouse_id: string | null
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
          brand_id: string | null
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
          brand_id?: string | null
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
          brand_id?: string | null
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
          {
            foreignKeyName: "products_cache_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_cache_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
        ]
      }
      purchasing_requirements: {
        Row: {
          back_order_qty: number | null
          cost_price: number | null
          current_stock: number | null
          lsa: number | null
          name: string | null
          on_order_qty: number | null
          open_asn_qty: number | null
          prefix: string | null
          reorder_qty: number | null
          sku: string | null
          supplier_id: string | null
          supplier_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_cache_brand_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_cache_brand_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
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
            foreignKeyName: "products_cache_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_cache_brand_id_fkey"
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
            foreignKeyName: "products_cache_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_cache_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_order_summary: {
        Row: {
          estimated_cost: number | null
          sku_count: number | null
          supplier_id: string | null
          supplier_name: string | null
          total_units: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_cache_brand_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_cache_brand_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "brands_missing_base_multiplier"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      bulk_update_lsa_from_sftp: {
        Args: { _payload: Json }
        Returns: {
          not_found_count: number
          not_found_skus: Json
          updated_count: number
        }[]
      }
      bulk_update_stock_from_sftp: {
        Args: { _payload: Json }
        Returns: {
          not_found_count: number
          updated_count: number
        }[]
      }
      capability_rank: {
        Args: { c: Database["public"]["Enums"]["app_capability"] }
        Returns: number
      }
      get_brands_with_product_counts: {
        Args: never
        Returns: {
          auto_update_lsa: boolean
          base_multiplier: number
          created_at: string
          family: string
          id: string
          image_search_domain: string
          image_url_pattern: string
          last_lsa_auto_update_at: string
          last_lsa_auto_update_summary: Json
          name: string
          prefix: string
          prefix_style: Database["public"]["Enums"]["prefix_style"]
          product_count: number
          remote_stock_feed_type: Database["public"]["Enums"]["remote_stock_feed_type"]
          stock_sync_interval_hours: number
        }[]
      }
      get_buy_recommendations: {
        Args: {
          p_brand_id?: string
          p_include_pending?: boolean
          p_supplier_id?: string
        }
        Returns: {
          back_orders: number
          brand_id: string
          brand_name: string
          current_stock: number
          low_stock_alert: number
          on_order: number
          pending_po_id: string
          pending_po_qty: number
          product_name: string
          required_qty: number
          sales_4w: number
          sku: string
          status: string
          supplier_id: string
          supplier_name: string
          unit_cost: number
        }[]
      }
      get_buy_recommendations_summary: {
        Args: never
        Returns: {
          missing_cost_count: number
          pending_po_count: number
          recommended_count: number
          total_required_cost: number
          total_required_qty: number
        }[]
      }
      get_despatch_channels: {
        Args: never
        Returns: {
          channel: string
          despatched_count: number
        }[]
      }
      get_despatch_halfhourly_today: {
        Args: never
        Returns: {
          despatched: number
          slot: string
        }[]
      }
      get_despatch_hourly_today: {
        Args: never
        Returns: {
          despatched: number
          hr: string
        }[]
      }
      get_despatch_performance: {
        Args: { from_date: string; to_date: string }
        Returns: {
          total_despatched: number
          within_24h: number
          within_48h: number
          within_72h: number
        }[]
      }
      get_despatch_performance_buckets: {
        Args: {
          bucket?: string
          channels?: string[]
          from_date: string
          to_date: string
        }
        Returns: {
          bucket_start: string
          channel: string
          mean_hours: number
          median_hours: number
          over_72h: number
          total: number
          under_12h: number
          under_24h: number
          under_36h: number
          under_48h: number
          under_6h: number
          under_72h: number
        }[]
      }
      get_despatch_today_vs_7d: {
        Args: never
        Returns: {
          avg7_pct: number
          today_on_time: number
          today_pct: number
          today_total: number
        }[]
      }
      get_despatched_today_authoritative: {
        Args: never
        Returns: {
          despatched_count: number
          last_despatched_at: string
          last_poll_at: string
          uk_date: string
        }[]
      }
      get_edge_function_runs: {
        Args: { _function_name: string; _limit?: number }
        Returns: {
          details: Json
          duration_ms: number
          ended_at: string
          function_name: string
          id: number
          message: string
          started_at: string
          status: string
        }[]
      }
      get_lsa_calibration:
        | {
            Args: { p_brand_id?: string }
            Returns: {
              base_multiplier: number
              brand_id: string
              brand_name: string
              current_lsa: number
              current_stock: number
              product_name: string
              sku: string
              status: string
              supplier_id: string
              supplier_name: string
              target_lsa: number
              weekly_velocity: number
            }[]
          }
        | {
            Args: { p_brand_id?: string; p_limit?: number; p_offset?: number }
            Returns: {
              base_multiplier: number
              brand_id: string
              brand_name: string
              current_lsa: number
              current_stock: number
              product_name: string
              sku: string
              status: string
              supplier_id: string
              supplier_name: string
              target_lsa: number
              weekly_velocity: number
            }[]
          }
      get_mintsoft_despatch_hourly_today: {
        Args: never
        Returns: {
          despatched: number
          hr: string
        }[]
      }
      get_mintsoft_status_latest: {
        Args: never
        Returns: {
          captured_at: string
          count: number
          status: string
        }[]
      }
      get_ops_daily_trend: {
        Args: { from_date: string; to_date: string }
        Returns: {
          awaiting_picking: number
          backorders: number
          day: string
          despatched: number
          new_orders: number
        }[]
      }
      get_ops_hourly_flow: {
        Args: never
        Returns: {
          despatched: number
          hour_of_day: number
          new_orders: number
        }[]
      }
      get_ops_queue_counts: {
        Args: never
        Returns: {
          awaiting_picking_count: number
          despatched_today_count: number
          new_count: number
          onbackorder_count: number
        }[]
      }
      get_ops_sku_issues: {
        Args: { lim?: number }
        Returns: {
          brand_id: string
          critical_count: number
          latest_issue: string
          problem_types: string[]
          sku: string
          total_issues: number
        }[]
      }
      get_ops_stage_ageing: {
        Args: never
        Returns: {
          avg_age_hours: number
          median_age_hours: number
          order_count: number
          status: string
        }[]
      }
      get_profit_week: {
        Args: { p_iso_week: number; p_iso_year: number }
        Returns: {
          aov: number
          channel_fees_total: number
          cost_total: number
          courier_cost_total: number
          dirt_count: number
          good_count: number
          iso_week: number
          iso_year: number
          line_count: number
          missing_cost_count: number
          order_count: number
          por_pct: number
          profit: number
          qty: number
          revenue: number
          week_end: string
          week_start: string
        }[]
      }
      get_profit_week_breakdown: {
        Args: { p_iso_week: number; p_iso_year: number }
        Returns: {
          band: string
          line_count: number
          pct: number
          profit_total: number
        }[]
      }
      get_status_snapshots_hourly_today: {
        Args: never
        Returns: {
          awaiting_count: number
          backorder_count: number
          hr: string
          new_count: number
          picked_count: number
        }[]
      }
      get_stock_health_summary: {
        Args: { p_brand_id?: string; p_exclude_dirt?: boolean }
        Returns: {
          by_category: Json
          dirt_skus: number
          total_on_hand: number
          total_skus: number
        }[]
      }
      get_system_health_job_runs: {
        Args: { _jobname: string; _limit?: number }
        Returns: {
          command: string
          database: string
          duration_ms: number
          end_time: string
          job_pid: number
          return_message: string
          runid: number
          start_time: string
          status: string
          username: string
        }[]
      }
      get_system_health_jobs: {
        Args: never
        Returns: {
          active: boolean
          jobname: string
          last_duration_ms: number
          last_end: string
          last_start: string
          last_status: string
          schedule: string
          seconds_since_last_run: number
        }[]
      }
      get_threeds_reprice_candidates: {
        Args: { p_channel: string; p_days?: number }
        Returns: {
          brand_name: string
          cost_total: number
          courier_total: number
          current_price: number
          current_stock: number
          fees_total: number
          por_pct: number
          product_name: string
          profit: number
          revenue: number
          sku: string
          units_sold: number
        }[]
      }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_area_capability: {
        Args: {
          area_key: string
          min_capability: Database["public"]["Enums"]["app_capability"]
          uid?: string
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
      pick_stalest_brand_for_stock_sync: {
        Args: never
        Returns: {
          id: string
          name: string
          oldest_sync: string
          sku_count: number
        }[]
      }
      refresh_lsa_brand_summary: { Args: never; Returns: undefined }
      refresh_sku_health_now: { Args: never; Returns: undefined }
      user_area_capability: {
        Args: { area_key: string; uid?: string }
        Returns: Database["public"]["Enums"]["app_capability"]
      }
    }
    Enums: {
      alert_type: "LowStock" | "RemoteStock" | "BackOrders" | "Inventory"
      app_capability: "none" | "read" | "propose" | "execute" | "admin"
      app_role: "super_user" | "senior_user" | "simple_user"
      approved_image_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "manual_required"
      catalogue_status: "draft" | "published" | "archived"
      image_scout_candidate_status:
        | "new"
        | "shortlisted"
        | "dismissed"
        | "manual_required"
        | "approved"
      prefix_style: "hyphen" | "slash"
      rbac_role:
        | "systems_controller"
        | "commercial_governor"
        | "inventory_steward"
        | "operations_steward"
        | "execution_operator"
        | "customer_service_operator"
        | "finance_governor"
        | "executive_viewer"
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
      app_capability: ["none", "read", "propose", "execute", "admin"],
      app_role: ["super_user", "senior_user", "simple_user"],
      approved_image_status: [
        "pending",
        "processing",
        "completed",
        "failed",
        "manual_required",
      ],
      catalogue_status: ["draft", "published", "archived"],
      image_scout_candidate_status: [
        "new",
        "shortlisted",
        "dismissed",
        "manual_required",
        "approved",
      ],
      prefix_style: ["hyphen", "slash"],
      rbac_role: [
        "systems_controller",
        "commercial_governor",
        "inventory_steward",
        "operations_steward",
        "execution_operator",
        "customer_service_operator",
        "finance_governor",
        "executive_viewer",
      ],
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
