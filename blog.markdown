---
layout: index
title: "Muhammad Usman Akram"
---

<div class="content" id="page">
    <div class="container">
	    <div class="blog">
	        <h2>My Log</h2>
	        <ul>
	        {% for log in site.posts %}
	            <li>
	            <span>{{ log.date | date: "%B %e, %Y" }}</span> - <a href="{{ log.url }}">{{ log.title }}</a>
	            </li>
	        {% endfor %}
	        </ul>
	    </div>
      <hr class="featurette-divider">
    </div> <!-- /container -->
</div>