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
      availability_requests: {
        Row: {
          created_at: string
          denial_reason: string | null
          end_date: string | null
          end_time: string | null
          hours_requested: number
          id: string
          notes: string | null
          request_type: string
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string
          start_time: string | null
          status: string
          time_scope: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          denial_reason?: string | null
          end_date?: string | null
          end_time?: string | null
          hours_requested?: number
          id?: string
          notes?: string | null
          request_type: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date: string
          start_time?: string | null
          status?: string
          time_scope: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          denial_reason?: string | null
          end_date?: string | null
          end_time?: string | null
          hours_requested?: number
          id?: string
          notes?: string | null
          request_type?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string
          start_time?: string | null
          status?: string
          time_scope?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_members: {
        Row: {
          chat_id: string
          id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          chat_id: string
          id?: string
          joined_at?: string
          user_id: string
        }
        Update: {
          chat_id?: string
          id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_members_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chats: {
        Row: {
          created_at: string
          created_by: string
          id: string
          is_group: boolean
          title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          is_group?: boolean
          title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          is_group?: boolean
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chats_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          checklist_id: string
          created_at: string | null
          id: string
          is_required: boolean | null
          item_type: string
          options: Json | null
          order_index: number
          question: string
          reference_image_url: string | null
          reference_link: string | null
          reference_notes: string | null
          reference_video_url: string | null
        }
        Insert: {
          checklist_id: string
          created_at?: string | null
          id?: string
          is_required?: boolean | null
          item_type: string
          options?: Json | null
          order_index: number
          question: string
          reference_image_url?: string | null
          reference_link?: string | null
          reference_notes?: string | null
          reference_video_url?: string | null
        }
        Update: {
          checklist_id?: string
          created_at?: string | null
          id?: string
          is_required?: boolean | null
          item_type?: string
          options?: Json | null
          order_index?: number
          question?: string
          reference_image_url?: string | null
          reference_link?: string | null
          reference_notes?: string | null
          reference_video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_responses: {
        Row: {
          created_at: string | null
          id: string
          item_id: string
          response_image_url: string | null
          response_text: string | null
          submission_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          item_id: string
          response_image_url?: string | null
          response_text?: string | null
          submission_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          item_id?: string
          response_image_url?: string | null
          response_text?: string | null
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_responses_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_responses_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "checklist_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_role_tags: {
        Row: {
          checklist_id: string
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          checklist_id: string
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          checklist_id?: string
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "checklist_role_tags_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_submissions: {
        Row: {
          checklist_id: string
          id: string
          notes: string | null
          submitted_at: string | null
          submitted_by: string
        }
        Insert: {
          checklist_id: string
          id?: string
          notes?: string | null
          submitted_at?: string | null
          submitted_by: string
        }
        Update: {
          checklist_id?: string
          id?: string
          notes?: string | null
          submitted_at?: string | null
          submitted_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_submissions_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_submissions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      checklists: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          frequency: string
          id: string
          is_active: boolean | null
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          frequency: string
          id?: string
          is_active?: boolean | null
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_type: string | null
          attachment_url: string | null
          chat_id: string
          content: string | null
          created_at: string
          id: string
          sender_id: string
          updated_at: string
        }
        Insert: {
          attachment_type?: string | null
          attachment_url?: string | null
          chat_id: string
          content?: string | null
          created_at?: string
          id?: string
          sender_id: string
          updated_at?: string
        }
        Update: {
          attachment_type?: string | null
          attachment_url?: string | null
          chat_id?: string
          content?: string | null
          created_at?: string
          id?: string
          sender_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          email: string
          full_name: string | null
          hourly_wage: number | null
          id: string
          is_active: boolean | null
          profile_photo_url: string | null
          role: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          full_name?: string | null
          hourly_wage?: number | null
          id: string
          is_active?: boolean | null
          profile_photo_url?: string | null
          role?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          full_name?: string | null
          hourly_wage?: number | null
          id?: string
          is_active?: boolean | null
          profile_photo_url?: string | null
          role?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      schedule_events: {
        Row: {
          created_at: string | null
          day_of_week: number
          event_name: string
          event_time: string
          id: string
          is_recurring: boolean
          notes: string | null
          schedule_id: string | null
          tagged_roles: Json | null
        }
        Insert: {
          created_at?: string | null
          day_of_week: number
          event_name: string
          event_time: string
          id?: string
          is_recurring?: boolean
          notes?: string | null
          schedule_id?: string | null
          tagged_roles?: Json | null
        }
        Update: {
          created_at?: string | null
          day_of_week?: number
          event_name?: string
          event_time?: string
          id?: string
          is_recurring?: boolean
          notes?: string | null
          schedule_id?: string | null
          tagged_roles?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_events_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_shifts: {
        Row: {
          created_at: string | null
          day_of_week: number
          end_time: string
          id: string
          is_time_off: boolean | null
          schedule_id: string | null
          shift_date: string
          start_time: string
          template_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          day_of_week: number
          end_time: string
          id?: string
          is_time_off?: boolean | null
          schedule_id?: string | null
          shift_date: string
          start_time: string
          template_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          day_of_week?: number
          end_time?: string
          id?: string
          is_time_off?: boolean | null
          schedule_id?: string | null
          shift_date?: string
          start_time?: string
          template_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_shifts_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_shifts_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "shift_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_published: boolean | null
          updated_at: string | null
          week_end_date: string
          week_start_date: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_published?: boolean | null
          updated_at?: string | null
          week_end_date: string
          week_start_date: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_published?: boolean | null
          updated_at?: string | null
          week_end_date?: string
          week_start_date?: string
        }
        Relationships: []
      }
      shift_templates: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          days_of_week: number[] | null
          end_time: string
          id: string
          position: string | null
          role: Database["public"]["Enums"]["app_role"]
          start_time: string
          template_name: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          days_of_week?: number[] | null
          end_time: string
          id?: string
          position?: string | null
          role: Database["public"]["Enums"]["app_role"]
          start_time: string
          template_name: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          days_of_week?: number[] | null
          end_time?: string
          id?: string
          position?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          start_time?: string
          template_name?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      wage_history: {
        Row: {
          created_at: string | null
          created_by: string | null
          effective_date: string
          hourly_wage: number
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          effective_date: string
          hourly_wage: number
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          effective_date?: string
          hourly_wage?: number
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wage_history_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wage_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_current_wage: {
        Args: { p_date?: string; p_user_id: string }
        Returns: number
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
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
      app_role: "admin" | "manager" | "team_member"
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
      app_role: ["admin", "manager", "team_member"],
    },
  },
} as const
