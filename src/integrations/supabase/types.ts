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
      brands: {
        Row: {
          created_at: string | null
          family: string | null
          id: string
          name: string
          prefix: string | null
          prefix_style: Database["public"]["Enums"]["prefix_style"] | null
        }
        Insert: {
          created_at?: string | null
          family?: string | null
          id?: string
          name: string
          prefix?: string | null
          prefix_style?: Database["public"]["Enums"]["prefix_style"] | null
        }
        Update: {
          created_at?: string | null
          family?: string | null
          id?: string
          name?: string
          prefix?: string | null
          prefix_style?: Database["public"]["Enums"]["prefix_style"] | null
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
            foreignKeyName: "download_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          api_key: string
          base_url: string
          id: boolean
          updated_at: string | null
        }
        Insert: {
          api_key: string
          base_url: string
          id?: boolean
          updated_at?: string | null
        }
        Update: {
          api_key?: string
          base_url?: string
          id?: boolean
          updated_at?: string | null
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
      profiles: {
        Row: {
          created_at: string | null
          email: string
          id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
        }
        Relationships: []
      }
    }
    Views: {
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
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      alert_type: "LowStock" | "RemoteStock" | "BackOrders" | "Inventory"
      prefix_style: "hyphen" | "slash"
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
      prefix_style: ["hyphen", "slash"],
      severity_type: ["info", "warning", "critical"],
    },
  },
} as const
