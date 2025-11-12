-- Create app_role enum
CREATE TYPE public.app_role AS ENUM ('super_user', 'senior_user', 'simple_user');

-- Add columns to existing profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS full_name TEXT,
ADD COLUMN IF NOT EXISTS avatar_url TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Create user_invites table for invite-only system
-- invited_by is nullable to allow system-created invites
CREATE TABLE public.user_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  role app_role NOT NULL,
  invited_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + interval '7 days'),
  used BOOLEAN NOT NULL DEFAULT false
);

-- Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_invites ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create function to check if user has any of multiple roles
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id UUID, _roles app_role[])
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = ANY(_roles)
  )
$$;

-- Add new profiles RLS policies
CREATE POLICY "Super and senior users can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (public.has_any_role(auth.uid(), ARRAY['super_user', 'senior_user']::app_role[]));

-- User roles RLS policies
CREATE POLICY "Users can view their own roles"
  ON public.user_roles
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Super users can view all roles"
  ON public.user_roles
  FOR SELECT
  USING (public.has_role(auth.uid(), 'super_user'));

CREATE POLICY "Super users can manage all roles"
  ON public.user_roles
  FOR ALL
  USING (public.has_role(auth.uid(), 'super_user'));

-- User invites RLS policies
CREATE POLICY "Super and senior users can view invites"
  ON public.user_invites
  FOR SELECT
  USING (public.has_any_role(auth.uid(), ARRAY['super_user', 'senior_user']::app_role[]));

CREATE POLICY "Super and senior users can create invites"
  ON public.user_invites
  FOR INSERT
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_user', 'senior_user']::app_role[]));

CREATE POLICY "Super and senior users can update invites"
  ON public.user_invites
  FOR UPDATE
  USING (public.has_any_role(auth.uid(), ARRAY['super_user', 'senior_user']::app_role[]));

CREATE POLICY "Super and senior users can delete invites"
  ON public.user_invites
  FOR DELETE
  USING (public.has_any_role(auth.uid(), ARRAY['super_user', 'senior_user']::app_role[]));

-- Update the handle_new_user function to include role assignment
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  invite_record RECORD;
BEGIN
  -- Update profile with metadata
  UPDATE public.profiles
  SET full_name = COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  WHERE id = NEW.id;

  -- If profile doesn't exist yet, insert it
  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', '')
    );
  END IF;

  -- Check if there's a valid invite for this email
  SELECT * INTO invite_record
  FROM public.user_invites
  WHERE email = NEW.email
    AND used = false
    AND expires_at > now()
  LIMIT 1;

  -- If invite exists, assign the role and mark invite as used
  IF invite_record IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, invite_record.role);
    
    UPDATE public.user_invites
    SET used = true
    WHERE id = invite_record.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Update trigger for profiles
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Insert the super user invite for robert@kashyyyk.co.uk
-- invited_by is NULL for system-created invites
INSERT INTO public.user_invites (email, role, invited_by, created_at, expires_at)
VALUES (
  'robert@kashyyyk.co.uk', 
  'super_user', 
  NULL,
  now(),
  now() + interval '30 days'
)
ON CONFLICT (email) DO NOTHING;