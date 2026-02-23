-- 1. Add columns to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS first_name text,
ADD COLUMN IF NOT EXISTS last_name text;

-- 2. Backfill existing rows
UPDATE public.users
SET 
    first_name = split_part(name, ' ', 1),
    last_name = CASE 
        WHEN position(' ' in name) > 0 THEN substring(name from position(' ' in name) + 1)
        ELSE ''
    END
WHERE name IS NOT NULL AND first_name IS NULL;

-- 3. Create function to automatically split name on insert/update
CREATE OR REPLACE FUNCTION public.set_first_last_name()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.name IS NOT NULL THEN
        NEW.first_name := split_part(NEW.name, ' ', 1);
        IF position(' ' in NEW.name) > 0 THEN
            NEW.last_name := substring(NEW.name from position(' ' in NEW.name) + 1);
        ELSE
            NEW.last_name := '';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Create trigger
DROP TRIGGER IF EXISTS trigger_set_first_last_name ON public.users;
CREATE TRIGGER trigger_set_first_last_name
    BEFORE INSERT OR UPDATE OF name
    ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.set_first_last_name();
