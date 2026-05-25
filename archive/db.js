import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config()
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY)

const { data, error } = await supabase
    .from('mascotas')
    .select()

console.log(data)