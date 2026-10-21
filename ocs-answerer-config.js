[
  {
    name: "OCS AI 本地转发",
    url: "http://127.0.0.1:8765/answer",
    method: "post",
    contentType: "json",
    type: "fetch",
    headers: {
      "Content-Type": "application/json"
    },
    data: {
      title: "${title}",
      type: "${type}",
      options: "${options}"
    },
    handler: "return (res) => res.code === 1 ? [res.question, res.answer] : undefined"
  }
]
