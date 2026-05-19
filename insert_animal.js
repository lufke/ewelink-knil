import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config()
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_API_KEY)

const { data, error } = await supabase
    .from('mascotas')
    .insert({
        nombre: 'Kyra',
        chip: '0',
        peso: 4.5,
    })

if (error) {
    console.error(error)
}
console.log(data)